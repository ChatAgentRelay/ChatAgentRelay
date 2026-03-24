import type { CanonicalEvent } from "@cap/contract-harness";
import { MiddlewarePipeline } from "@cap/middleware";
import { DeliveryOrchestrator } from "@cap/delivery";
import { EventLedgerAppender, EventLedgerReader, InMemoryEventLedgerStore } from "@cap/event-ledger";
import type { SendFn } from "@cap/delivery";
import type { BackendAdapter, ChannelIngress, PipelineConfig, PipelineResult } from "./types";

export class FirstExecutablePathPipeline {
  private constructor(
    private readonly ingress: ChannelIngress,
    private readonly middleware: MiddlewarePipeline,
    private readonly backend: BackendAdapter,
    private readonly delivery: DeliveryOrchestrator,
    private readonly appender: EventLedgerAppender,
    private readonly reader: EventLedgerReader,
    private readonly sendFn: SendFn,
  ) {}

  static async create(config: PipelineConfig): Promise<FirstExecutablePathPipeline> {
    const store = config.ledgerStore ?? new InMemoryEventLedgerStore();
    const [middleware, delivery, appender] = await Promise.all([
      MiddlewarePipeline.create(config.middleware),
      DeliveryOrchestrator.create(),
      EventLedgerAppender.create(store),
    ]);
    const reader = new EventLedgerReader(store);
    return new FirstExecutablePathPipeline(
      config.ingress, middleware, config.backend, delivery, appender, reader, config.sendFn,
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
      throw new Error(`Backend invocation failed: ${backendResult.error.message}`);
    }
    const agentResponse = backendResult.event;
    this.appendToLedger(agentResponse);

    const deliveryResult = await this.delivery.deliver(agentResponse, this.sendFn);
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

  private appendToLedger(event: CanonicalEvent): void {
    this.appender.append(event);
  }
}
