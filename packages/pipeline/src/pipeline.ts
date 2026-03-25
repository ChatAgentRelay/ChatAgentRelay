import type { CanonicalEvent } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";
import { MiddlewarePipeline } from "@cap/middleware";
import { DeliveryOrchestrator } from "@cap/delivery";
import { EventLedgerAppender, EventLedgerReader, InMemoryEventLedgerStore } from "@cap/event-ledger";
import type { BackendAdapter, ChannelIngress, PipelineConfig, PipelineResult } from "./types";

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
    private readonly sendFn: (text: string) => Promise<{ providerMessageId: string }>,
    private readonly validators: ContractHarnessValidators,
  ) {}

  static async create(config: PipelineConfig): Promise<FirstExecutablePathPipeline> {
    const store = config.ledgerStore ?? new InMemoryEventLedgerStore();
    const [middleware, delivery, appender, validators] = await Promise.all([
      MiddlewarePipeline.create(config.middleware),
      DeliveryOrchestrator.create(),
      EventLedgerAppender.create(store),
      ContractHarnessValidators.create(),
    ]);
    const reader = new EventLedgerReader(store);
    return new FirstExecutablePathPipeline(
      config.ingress, middleware, config.backend, delivery, appender, reader, config.sendFn, validators,
    );
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
    this.appendToLedger(mwResult.routeEvent);
    this.appendToLedger(mwResult.invocationEvent);

    const backendResult = await this.backend.invoke({
      invocationEvent: mwResult.invocationEvent,
      messageText: messageReceived.payload["text"] as string,
      route: {
        route_id: mwResult.routeEvent.payload["route"] as string,
        reason: mwResult.routeEvent.payload["reason"] as string,
      },
      policy: {
        policy_id: mwResult.policyEvent.payload["policy"] as string,
        decision: mwResult.policyEvent.payload["decision"] as string,
      },
    });

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
        events: [
          messageReceived,
          mwResult.policyEvent,
          mwResult.routeEvent,
          mwResult.invocationEvent,
          blocked,
        ],
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
      const blocked = deriveBlockedEvent(
        messageReceived,
        agentResponse.event_id,
        reason,
        "delivery",
        false,
      );
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
