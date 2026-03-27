import type { ConversationTurn } from "@chat-agent-relay/backend-http";
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DeliveryOrchestrator } from "@chat-agent-relay/delivery";
import type { LedgerStore } from "@chat-agent-relay/event-ledger";
import { EventLedgerAppender, EventLedgerReader, InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import { MiddlewarePipeline } from "@chat-agent-relay/middleware";
import type { BackendAdapter, ChannelIngress, PipelineConfig, PipelineResult, StreamingOptions } from "./types";

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
    private readonly middleware: MiddlewarePipeline,
    private readonly backend: BackendAdapter,
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
    const [middleware, delivery, appender, validators] = await Promise.all([
      MiddlewarePipeline.create(config.middleware),
      DeliveryOrchestrator.create(config.retryConfig),
      EventLedgerAppender.create(store),
      ContractHarnessValidators.create(),
    ]);
    const reader = new EventLedgerReader(store);
    return new FirstExecutablePathPipeline(
      config.ingress,
      middleware,
      config.backend,
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

    const mwResult = this.middleware.process(messageReceived);
    this.appendToLedger(mwResult.policyEvent);

    if (!mwResult.allowed) {
      const blocked = deriveBlockedEvent(
        messageReceived,
        mwResult.policyEvent.event_id,
        mwResult.denyReason,
        "governance",
        false,
      );
      this.validateAndAppend(blocked);

      return {
        events: [messageReceived, mwResult.policyEvent, blocked],
        blocked: true,
        blockReason: mwResult.denyReason,
        explanation: {
          inboundText: messageReceived.payload["text"] as string,
          policyDecision: "deny",
          selectedRoute: "",
          backendResponse: "",
          providerMessageId: "",
        },
      };
    }

    this.appendToLedger(mwResult.routeEvent);
    this.appendToLedger(mwResult.invocationEvent);

    const conversationHistory = this.buildConversationHistory(messageReceived.conversation_id);

    const invocationContext = {
      invocationEvent: mwResult.invocationEvent,
      messageText: messageReceived.payload["text"] as string,
      conversationHistory,
      route: {
        route_id: mwResult.routeEvent.payload["route"] as string,
        reason: mwResult.routeEvent.payload["reason"] as string,
      },
      policy: {
        policy_id: mwResult.policyEvent.payload["policy"] as string,
        decision: mwResult.policyEvent.payload["decision"] as string,
      },
    };

    const backendResult =
      this.streaming?.enabled && this.backend.invokeStreaming
        ? await this.invokeWithStreaming(invocationContext)
        : await this.backend.invoke(invocationContext);

    if (!backendResult.ok) {
      const blocked = deriveBlockedEvent(
        messageReceived,
        mwResult.invocationEvent.event_id,
        backendResult.error.message,
        "backend_invocation",
        backendResult.error.retryable,
      );
      this.validateAndAppend(blocked);

      return {
        events: [messageReceived, mwResult.policyEvent, mwResult.routeEvent, mwResult.invocationEvent, blocked],
        blocked: true,
        blockReason: backendResult.error.message,
        explanation: {
          inboundText: messageReceived.payload["text"] as string,
          policyDecision: mwResult.policyEvent.payload["decision"] as string,
          selectedRoute: mwResult.routeEvent.payload["route"] as string,
          backendResponse: "",
          providerMessageId: "",
        },
      };
    }

    const agentResponse = backendResult.event;
    this.appendToLedger(agentResponse);

    let deliveryResult;
    try {
      deliveryResult = await this.delivery.deliver(agentResponse, this.sendFn);
    } catch (deliveryError) {
      const reason = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      const blocked = deriveBlockedEvent(messageReceived, agentResponse.event_id, reason, "delivery", false);
      this.validateAndAppend(blocked);

      return {
        events: [
          messageReceived,
          mwResult.policyEvent,
          mwResult.routeEvent,
          mwResult.invocationEvent,
          agentResponse,
          blocked,
        ],
        blocked: true,
        blockReason: reason,
        explanation: {
          inboundText: messageReceived.payload["text"] as string,
          policyDecision: mwResult.policyEvent.payload["decision"] as string,
          selectedRoute: mwResult.routeEvent.payload["route"] as string,
          backendResponse: agentResponse.payload["text"] as string,
          providerMessageId: "",
        },
      };
    }

    this.appendToLedger(deliveryResult.sendRequestedEvent);
    this.appendToLedger(deliveryResult.sentEvent);

    const events = [
      messageReceived,
      mwResult.policyEvent,
      mwResult.routeEvent,
      mwResult.invocationEvent,
      agentResponse,
      deliveryResult.sendRequestedEvent,
      deliveryResult.sentEvent,
    ];

    return {
      events,
      explanation: {
        inboundText: messageReceived.payload["text"] as string,
        policyDecision: mwResult.policyEvent.payload["decision"] as string,
        selectedRoute: mwResult.routeEvent.payload["route"] as string,
        backendResponse: agentResponse.payload["text"] as string,
        providerMessageId: deliveryResult.providerMessageId,
      },
    };
  }

  replayConversation(conversationId: string) {
    return this.reader.replayConversation(conversationId);
  }

  private async invokeWithStreaming(
    context: import("@chat-agent-relay/backend-http").InvocationContext,
  ): Promise<import("@chat-agent-relay/backend-http").InvocationResult> {
    const generator = this.backend.invokeStreaming!(context);
    const updateIntervalMs = this.streaming?.updateIntervalMs ?? 800;

    const initialResult = await this.streaming!.postInitial("...");
    const messageTs = initialResult.providerMessageId;

    let accumulated = "";
    let lastUpdateTime = Date.now();

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
        return value;
      }

      accumulated += value;
      const now = Date.now();
      if (now - lastUpdateTime >= updateIntervalMs && messageTs) {
        try {
          await this.streaming!.updateMessage(accumulated);
          lastUpdateTime = now;
        } catch {
          /* best-effort update, continue streaming */
        }
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
