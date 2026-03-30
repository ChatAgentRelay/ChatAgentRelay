import type {
  AgentAdapter,
  AgentEvent,
  AgentInvocationContext,
  AgentResult,
  CanonicalEvent,
  ConversationTurn,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DeliveryOrchestrator } from "@chat-agent-relay/delivery";
import type { LedgerStore } from "@chat-agent-relay/event-ledger";
import { EventLedgerAppender, EventLedgerReader, InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import type { ChannelIngress, PipelineConfig, PipelineResult, RouteFn, StreamingOptions } from "./types";

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
    private readonly ingress: ChannelIngress,
    private readonly resolveAgent: (name: string) => AgentAdapter | undefined,
    private readonly routeFn: RouteFn,
    private readonly channelName: string,
    private readonly policyId: string,
    private readonly policyFn: ((event: CanonicalEvent) => { decision: "allow" | "deny"; reason?: string }) | undefined,
    private readonly delivery: DeliveryOrchestrator,
    private readonly appender: EventLedgerAppender,
    private readonly reader: EventLedgerReader,
    private readonly store: LedgerStore,
    private readonly sendFn: (text: string) => Promise<{ providerMessageId: string }>,
    private readonly validators: ContractHarnessValidators,
    private readonly streaming?: StreamingOptions | undefined,
  ) {}

  static async create(config: PipelineConfig): Promise<FirstExecutablePathPipeline> {
    const store = config.ledgerStore ?? new InMemoryEventLedgerStore();
    const [delivery, appender, validators] = await Promise.all([
      DeliveryOrchestrator.create(config.retryConfig),
      EventLedgerAppender.create(store),
      ContractHarnessValidators.create(),
    ]);
    const reader = new EventLedgerReader(store);
    return new FirstExecutablePathPipeline(
      config.ingress,
      config.resolveAgent,
      config.routeFn,
      config.channelName,
      config.policyId ?? "default_ingress",
      config.policyFn,
      delivery,
      appender,
      reader,
      store,
      config.sendFn,
      validators,
      config.streaming,
    );
  }

  private buildConversationHistory(conversationId: string): ConversationTurn[] {
    const events = this.store.getByConversationId(conversationId);
    const turns: ConversationTurn[] = [];
    for (const event of events) {
      if (event.event_type === "message.received" && typeof event.payload["text"] === "string") {
        turns.push({ role: "user", content: event.payload["text"] });
      } else if (event.event_type === "agent.response.completed" && typeof event.payload["text"] === "string") {
        turns.push({ role: "assistant", content: event.payload["text"] });
      }
    }
    return turns;
  }

  async execute(rawInput: unknown): Promise<PipelineResult> {
    const canonResult = this.ingress.canonicalize(rawInput);
    if (!canonResult.ok) {
      throw new Error(`Ingress failed: ${canonResult.error.message}`);
    }
    const messageReceived = canonResult.event;
    this.appendToLedger(messageReceived);

    if (messageReceived.event_type !== "message.received") {
      throw new Error(`Expected message.received, got ${messageReceived.event_type}`);
    }

    const policyDecision = this.policyFn
      ? this.policyFn(messageReceived)
      : { decision: "allow" as const };

    const policyEvent = deriveEvent(messageReceived, messageReceived.event_id, "policy.decision.made", {
      policy: this.policyId,
      decision: policyDecision.decision,
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

    const messageText = messageReceived.payload["text"] as string;
    const routeDecision = this.routeFn(this.channelName, messageText);
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

    const routeReason =
      routeDecision.reason.trim() || routeDecision.matchType.trim() || "route";
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

    const conversationHistory = this.buildConversationHistory(messageReceived.conversation_id);

    const invocationContext: AgentInvocationContext = {
      invocationEvent,
      messageText,
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
      this.streaming?.enabled && agent.stream
        ? await this.invokeWithStreaming(agent, invocationContext)
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

    const agentResponse = agentResult.event;
    this.appendToLedger(agentResponse);

    let deliveryResult;
    try {
      deliveryResult = await this.delivery.deliver(agentResponse, this.sendFn);
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

  private async invokeWithStreaming(
    agent: AgentAdapter,
    context: AgentInvocationContext,
  ): Promise<AgentResult & { hitlPending?: boolean }> {
    const generator = agent.stream!(context);
    const updateIntervalMs = this.streaming?.updateIntervalMs ?? 800;

    const initialResult = await this.streaming!.postInitial("...");
    const messageTs = initialResult.providerMessageId;

    let accumulated = "";
    let lastUpdateTime = Date.now();
    let hitlPending = false;

    while (true) {
      const { done, value } = await generator.next();
      if (done) {
        if (accumulated) {
          try {
            await this.streaming!.updateMessage(accumulated);
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
            await this.streaming!.updateMessage(accumulated);
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
