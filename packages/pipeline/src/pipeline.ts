import type {
  AgentAdapter,
  AgentEvent,
  AgentInvocationContext,
  AgentPart,
  AgentResult,
  CanonicalEvent,
  ChannelAdapter,
  ChannelSender,
  ConversationTurn,
  InboundAttachment,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DeliveryOrchestrator } from "@chat-agent-relay/delivery";
import type { LedgerStore } from "@chat-agent-relay/event-ledger";
import { EventLedgerAppender, EventLedgerReader, InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import { type AccessControlConfig, checkAccess, type RateLimiter } from "@chat-agent-relay/middleware";
import type { PipelineConfig, PipelineResult, RouteFn, StreamingOptions } from "./types";

function deriveEvent(
  source: CanonicalEvent,
  causationId: string,
  eventType: string,
  payload: Record<string, unknown>,
): CanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: eventType,
    tenant_id: source.tenant_id,
    workspace_id: source.workspace_id,
    channel: source.channel,
    channel_instance_id: source.channel_instance_id ?? source.channel,
    conversation_id: source.conversation_id,
    session_id: source.session_id,
    correlation_id: source.correlation_id,
    causation_id: causationId,
    occurred_at: new Date().toISOString(),
    actor_type: "system",
    payload,
  };
}

function deriveBlockedEvent(
  source: CanonicalEvent,
  causationId: string,
  reason: string,
  blockStage: string,
  retryable: boolean,
): CanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: "event.blocked",
    tenant_id: source.tenant_id,
    workspace_id: source.workspace_id,
    channel: source.channel,
    channel_instance_id: source.channel_instance_id ?? source.channel,
    conversation_id: source.conversation_id,
    session_id: source.session_id,
    correlation_id: source.correlation_id,
    causation_id: causationId,
    occurred_at: new Date().toISOString(),
    actor_type: "system",
    payload: { reason, block_stage: blockStage, retryable },
  };
}

export class FirstExecutablePathPipeline {
  private constructor(
    private readonly channel: ChannelAdapter,
    private readonly resolveAgent: (name: string) => AgentAdapter | undefined,
    private readonly routeFn: RouteFn,
    private readonly policyId: string,
    private readonly policyFn: ((event: CanonicalEvent) => { decision: "allow" | "deny"; reason?: string }) | undefined,
    private readonly outboundPolicyId: string,
    private readonly outboundPolicyFn:
      | ((event: CanonicalEvent) => { decision: "allow" | "deny"; reason?: string })
      | undefined,
    private readonly accessControl: AccessControlConfig | undefined,
    private readonly rateLimiter: RateLimiter | undefined,
    private readonly delivery: DeliveryOrchestrator,
    private readonly appender: EventLedgerAppender,
    private readonly reader: EventLedgerReader,
    private readonly store: LedgerStore,
    private readonly validators: ContractHarnessValidators,
    private readonly streamingEnabled: boolean,
    private readonly streamingIntervalMs: number,
    private readonly streamingOverride?: StreamingOptions | undefined,
  ) {}

  static async create(config: PipelineConfig): Promise<FirstExecutablePathPipeline> {
    const store = config.ledgerStore ?? new InMemoryEventLedgerStore();
    const [delivery, appender, validators] = await Promise.all([
      DeliveryOrchestrator.create(config.retryConfig),
      EventLedgerAppender.create(store),
      ContractHarnessValidators.getShared(),
    ]);
    const reader = new EventLedgerReader(store);
    return new FirstExecutablePathPipeline(
      config.channel,
      config.resolveAgent,
      config.routeFn,
      config.policyId ?? "default_ingress",
      config.policyFn,
      config.outboundPolicyId ?? "default_outbound",
      config.outboundPolicyFn,
      config.accessControl,
      config.rateLimiter,
      delivery,
      appender,
      reader,
      store,
      validators,
      config.streamingEnabled ?? false,
      config.streamingIntervalMs ?? 800,
      config.streamingOverride,
    );
  }

  private buildConversationHistory(conversationId: string): ConversationTurn[] {
    const events = this.store.getByConversationId(conversationId);
    const turns: ConversationTurn[] = [];
    for (const event of events) {
      if (event.event_type === "message.received" && typeof event.payload["text"] === "string") {
        turns.push({ role: "user", content: event.payload["text"] });
      } else if (event.event_type === "command.received" && typeof event.payload["text"] === "string") {
        const cmd = event.payload["command_name"] as string | undefined;
        const text = event.payload["text"] as string;
        turns.push({ role: "user", content: cmd ? `/${cmd} ${text}` : text });
      } else if (event.event_type === "agent.response.completed" && typeof event.payload["text"] === "string") {
        turns.push({ role: "assistant", content: event.payload["text"] });
      }
    }
    return turns;
  }

  private extractCommandText(event: CanonicalEvent): string {
    const commandName = event.payload["command_name"] as string | undefined;
    const text = event.payload["text"] as string;
    return commandName ? `/${commandName} ${text}` : text;
  }

  private resolveSenderId(event: CanonicalEvent): string | undefined {
    const actor = event["actor"];
    if (typeof actor === "object" && actor !== null) {
      const actorId = (actor as Record<string, unknown>)["id"];
      if (typeof actorId === "string" && actorId.length > 0) {
        return actorId;
      }
    }

    const payloadUserId = event.payload["user_id"];
    if (typeof payloadUserId === "string" && payloadUserId.length > 0) {
      return payloadUserId;
    }

    return undefined;
  }

  private resolveRateLimitKey(event: CanonicalEvent): string | undefined {
    if (!this.rateLimiter) {
      return undefined;
    }

    switch (this.rateLimiter.scope) {
      case "sender":
        return this.resolveSenderId(event);
      case "conversation":
        return event.conversation_id;
      case "tenant":
        return event.tenant_id;
    }
  }

  async execute(rawInput: unknown): Promise<PipelineResult> {
    const canonResult = this.channel.canonicalize(rawInput);
    if (!canonResult.ok) {
      throw new Error(`Ingress failed: ${canonResult.error.message}`);
    }
    const messageReceived = canonResult.event;
    this.appendToLedger(messageReceived);

    const PROCESSABLE_TYPES = new Set(["message.received", "command.received"]);
    if (!PROCESSABLE_TYPES.has(messageReceived.event_type)) {
      throw new Error(`Expected message.received or command.received, got ${messageReceived.event_type}`);
    }

    const sender = this.channel.createSender(messageReceived);
    const streaming = this.resolveStreaming(sender);

    if (this.accessControl) {
      const senderId = this.resolveSenderId(messageReceived);
      if (senderId) {
        const accessDecision = checkAccess(this.accessControl, senderId);
        if (!accessDecision.allowed) {
          const blocked = deriveBlockedEvent(
            messageReceived,
            messageReceived.event_id,
            accessDecision.reason ?? "access_denied",
            "access_control",
            false,
          );
          this.validateAndAppend(blocked);

          return {
            events: [messageReceived, blocked],
            blocked: true,
            blockReason: accessDecision.reason ?? "access_denied",
            explanation: {
              inboundText: messageReceived.payload["text"] as string,
              policyDecision: "not_evaluated",
              selectedRoute: "",
              backendResponse: "",
              providerMessageId: "",
            },
          };
        }
      }
    }

    if (this.rateLimiter) {
      const rateLimitKey = this.resolveRateLimitKey(messageReceived);
      if (rateLimitKey) {
        const rateLimitDecision = this.rateLimiter.check(rateLimitKey);
        if (!rateLimitDecision.allowed) {
          const blocked = deriveBlockedEvent(
            messageReceived,
            messageReceived.event_id,
            `rate limit exceeded${rateLimitDecision.retryAfterMs !== undefined ? `; retry_after_ms=${rateLimitDecision.retryAfterMs}` : ""}`,
            "rate_limit",
            true,
          );
          this.validateAndAppend(blocked);

          return {
            events: [messageReceived, blocked],
            blocked: true,
            blockReason: blocked.payload["reason"] as string,
            explanation: {
              inboundText: messageReceived.payload["text"] as string,
              policyDecision: "not_evaluated",
              selectedRoute: "",
              backendResponse: "",
              providerMessageId: "",
            },
          };
        }
      }
    }

    const policyDecision = this.policyFn ? this.policyFn(messageReceived) : { decision: "allow" as const };

    const policyEvent = deriveEvent(messageReceived, messageReceived.event_id, "policy.decision.made", {
      policy: this.policyId,
      decision: policyDecision.decision,
      stage: "inbound",
      ...(policyDecision.reason !== undefined ? { reason: policyDecision.reason } : {}),
    });
    this.validateAndAppend(policyEvent);

    if (policyDecision.decision === "deny") {
      const blocked = deriveBlockedEvent(
        messageReceived,
        policyEvent.event_id,
        policyDecision.reason ?? "policy_deny",
        "governance",
        false,
      );
      this.validateAndAppend(blocked);

      return {
        events: [messageReceived, policyEvent, blocked],
        blocked: true,
        blockReason: policyDecision.reason ?? "policy_deny",
        explanation: {
          inboundText: messageReceived.payload["text"] as string,
          policyDecision: "deny",
          selectedRoute: "",
          backendResponse: "",
          providerMessageId: "",
        },
      };
    }

    const messageText = messageReceived.event_type === "command.received"
      ? this.extractCommandText(messageReceived)
      : (messageReceived.payload["text"] as string);
    const channelName = this.channel.channelType;
    const routeDecision = this.routeFn(channelName, messageText);
    if (routeDecision === null) {
      const blocked = deriveBlockedEvent(messageReceived, policyEvent.event_id, "no_route_matched", "routing", false);
      this.validateAndAppend(blocked);

      return {
        events: [messageReceived, policyEvent, blocked],
        blocked: true,
        blockReason: "no_route_matched",
        explanation: {
          inboundText: messageText,
          policyDecision: policyEvent.payload["decision"] as string,
          selectedRoute: "",
          backendResponse: "",
          providerMessageId: "",
        },
      };
    }

    const routeReason = routeDecision.reason.trim() || routeDecision.matchType.trim() || "route";
    const routeEvent = deriveEvent(messageReceived, policyEvent.event_id, "route.decision.made", {
      route: routeDecision.agentName,
      reason: routeReason,
    });
    this.validateAndAppend(routeEvent);

    const agent = this.resolveAgent(routeDecision.agentName);
    if (agent === undefined) {
      const blocked = deriveBlockedEvent(
        messageReceived,
        routeEvent.event_id,
        `agent_not_found: ${routeDecision.agentName}`,
        "routing",
        false,
      );
      this.validateAndAppend(blocked);

      return {
        events: [messageReceived, policyEvent, routeEvent, blocked],
        blocked: true,
        blockReason: `agent_not_found: ${routeDecision.agentName}`,
        explanation: {
          inboundText: messageText,
          policyDecision: policyEvent.payload["decision"] as string,
          selectedRoute: routeEvent.payload["route"] as string,
          backendResponse: "",
          providerMessageId: "",
        },
      };
    }

    const invocationEvent = deriveEvent(messageReceived, routeEvent.event_id, "agent.invocation.requested", {
      backend: routeDecision.agentName,
      input_event_id: messageReceived.event_id,
    });
    this.validateAndAppend(invocationEvent);

    try {
      await sender.sendTyping?.();
    } catch {
      // Typing indicators are best-effort; ignore failures.
    }

    const agentCaps = agent.describeCapabilities();
    const conversationHistory = agentCaps.multiTurn
      ? this.buildConversationHistory(messageReceived.conversation_id)
      : [];

    const parts = this.extractPartsFromAttachments(messageReceived);

    const invocationContext: AgentInvocationContext = {
      invocationEvent,
      messageText,
      ...(parts.length > 0 ? { parts } : {}),
      conversationHistory,
      route: {
        route_id: String(routeDecision.routeId),
        reason: routeReason,
      },
      policy: {
        policy_id: policyEvent.payload["policy"] as string,
        decision: policyEvent.payload["decision"] as string,
      },
    };

    const agentResult =
      streaming?.enabled && agentCaps.streaming && agent.stream
        ? await this.invokeWithStreaming(agent, invocationContext, streaming)
        : await agent.invoke(invocationContext);

    if (!agentResult.ok) {
      const blocked = deriveBlockedEvent(
        messageReceived,
        invocationEvent.event_id,
        agentResult.error.message,
        "backend_invocation",
        agentResult.error.retryable,
      );
      this.validateAndAppend(blocked);

      return {
        events: [messageReceived, policyEvent, routeEvent, invocationEvent, blocked],
        blocked: true,
        blockReason: agentResult.error.message,
        explanation: {
          inboundText: messageText,
          policyDecision: policyEvent.payload["decision"] as string,
          selectedRoute: routeEvent.payload["route"] as string,
          backendResponse: "",
          providerMessageId: "",
        },
      };
    }

    let agentResponse: CanonicalEvent = agentResult.event;
    if (agentResult.artifacts !== undefined && agentResult.artifacts.length > 0) {
      const prev = agentResult.event.provider_extensions;
      const baseExt =
        prev !== undefined && typeof prev === "object" && prev !== null && !Array.isArray(prev)
          ? { ...(prev as Record<string, unknown>) }
          : {};
      agentResponse = {
        ...agentResult.event,
        provider_extensions: {
          ...baseExt,
          artifacts: agentResult.artifacts,
        },
      };
    }
    this.appendToLedger(agentResponse);

    let outboundPolicyEvent: CanonicalEvent | undefined;
    if (this.outboundPolicyFn) {
      const outboundDecision = this.outboundPolicyFn(agentResponse);
      outboundPolicyEvent = deriveEvent(messageReceived, agentResponse.event_id, "policy.decision.made", {
        policy: this.outboundPolicyId,
        decision: outboundDecision.decision,
        stage: "outbound",
        ...(outboundDecision.reason !== undefined ? { reason: outboundDecision.reason } : {}),
      });
      this.validateAndAppend(outboundPolicyEvent);

      if (outboundDecision.decision === "deny") {
        const blocked = deriveBlockedEvent(
          messageReceived,
          outboundPolicyEvent.event_id,
          outboundDecision.reason ?? "outbound_policy_deny",
          "outbound_governance",
          false,
        );
        this.validateAndAppend(blocked);

        return {
          events: [
            messageReceived,
            policyEvent,
            routeEvent,
            invocationEvent,
            agentResponse,
            outboundPolicyEvent,
            blocked,
          ],
          blocked: true,
          blockReason: outboundDecision.reason ?? "outbound_policy_deny",
          ...(agentResult.sessionHandle ? { sessionHandle: agentResult.sessionHandle } : {}),
          ...("hitlPending" in agentResult && agentResult.hitlPending ? { hitlPending: true } : {}),
          explanation: {
            inboundText: messageText,
            policyDecision: outboundPolicyEvent.payload["decision"] as string,
            selectedRoute: routeEvent.payload["route"] as string,
            backendResponse: agentResponse.payload["text"] as string,
            providerMessageId: "",
          },
        };
      }
    }

    let deliveryResult;
    try {
      // Text send and optional reaction egress (provider_extensions.reaction) run inside deliver().
      deliveryResult = await this.delivery.deliver(agentResponse, sender);
    } catch (deliveryError) {
      const reason = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      const blocked = deriveBlockedEvent(messageReceived, agentResponse.event_id, reason, "delivery", false);
      this.validateAndAppend(blocked);

      return {
        events: [messageReceived, policyEvent, routeEvent, invocationEvent, agentResponse, blocked],
        blocked: true,
        blockReason: reason,
        explanation: {
          inboundText: messageText,
          policyDecision: policyEvent.payload["decision"] as string,
          selectedRoute: routeEvent.payload["route"] as string,
          backendResponse: agentResponse.payload["text"] as string,
          providerMessageId: "",
        },
      };
    }

    this.appendToLedger(deliveryResult.sendRequestedEvent);
    this.appendToLedger(deliveryResult.sentEvent);

    const events = [
      messageReceived,
      policyEvent,
      routeEvent,
      invocationEvent,
      agentResponse,
      ...(outboundPolicyEvent ? [outboundPolicyEvent] : []),
      deliveryResult.sendRequestedEvent,
      deliveryResult.sentEvent,
    ];

    return {
      events,
      ...(agentResult.ok && agentResult.sessionHandle ? { sessionHandle: agentResult.sessionHandle } : {}),
      ...("hitlPending" in agentResult && agentResult.hitlPending ? { hitlPending: true } : {}),
      explanation: {
        inboundText: messageText,
        policyDecision: policyEvent.payload["decision"] as string,
        selectedRoute: routeEvent.payload["route"] as string,
        backendResponse: agentResponse.payload["text"] as string,
        providerMessageId: deliveryResult.providerMessageId,
      },
    };
  }

  replayConversation(conversationId: string) {
    return this.reader.replayConversation(conversationId);
  }

  private resolveStreaming(sender: ChannelSender): StreamingOptions | undefined {
    if (this.streamingOverride) return this.streamingOverride;
    if (!this.streamingEnabled) return undefined;

    const caps = this.channel.describeCapabilities();
    if (!caps.streaming.progressiveUpdate || !sender.edit) return undefined;

    let messageId: string | undefined;
    return {
      enabled: true,
      updateIntervalMs: this.streamingIntervalMs,
      postInitial: async (placeholder: string) => {
        const result = await sender.send(placeholder);
        messageId = result.providerMessageId;
        return result;
      },
      updateMessage: async (text: string) => {
        if (messageId) await sender.edit!(messageId, text);
      },
    };
  }

  private async invokeWithStreaming(
    agent: AgentAdapter,
    context: AgentInvocationContext,
    streaming: StreamingOptions,
  ): Promise<AgentResult & { hitlPending?: boolean }> {
    const generator = agent.stream!(context);
    const updateIntervalMs = streaming.updateIntervalMs ?? 800;

    const initialResult = await streaming.postInitial("...");
    const messageTs = initialResult.providerMessageId;

    let accumulated = "";
    let lastUpdateTime = Date.now();
    let hitlPending = false;

    while (true) {
      const { done, value } = await generator.next();
      if (done) {
        if (accumulated) {
          try {
            await streaming.updateMessage(accumulated);
          } catch {
            /* best-effort final update */
          }
        }
        return hitlPending ? { ...value, hitlPending } : value;
      }

      const event: AgentEvent = value;
      if (event.type === "text_delta") {
        accumulated += event.content;
        const now = Date.now();
        if (now - lastUpdateTime >= updateIntervalMs && messageTs) {
          try {
            await streaming.updateMessage(accumulated);
            lastUpdateTime = now;
          } catch {
            /* best-effort update, continue streaming */
          }
        }
      } else if (event.type === "input_required") {
        hitlPending = true;
      }
    }
  }

  private extractPartsFromAttachments(event: CanonicalEvent): AgentPart[] {
    const rawAttachments = event.payload["attachments"];
    if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) return [];
    const parts: AgentPart[] = [];
    for (const att of rawAttachments as InboundAttachment[]) {
      if (!att.attachment_id) continue;
      const mimeType = att.mime_type ?? "application/octet-stream";
      parts.push({
        kind: "file",
        name: att.filename ?? att.attachment_id,
        mimeType,
        ...(att.url ? { uri: att.url } : {}),
      });
    }
    return parts;
  }

  private validateAndAppend(event: CanonicalEvent): void {
    const validation = this.validators.validateEvent(event);
    if (!validation.ok) {
      const details = validation.failure.issues.map((i) => i.message).join("; ");
      throw new Error(`Pipeline produced invalid ${event.event_type}: ${details}`);
    }
    this.appendToLedger(event);
  }

  private appendToLedger(event: CanonicalEvent): void {
    this.appender.append(event);
  }
}
