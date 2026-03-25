import type { CanonicalEvent, ValidationResult } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";
import type { DeliveryResult, RetryConfig, SendFn } from "./types";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export class DeliveryExhaustedError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(`Delivery failed after ${attempts} attempts: ${lastError.message}`);
    this.name = "DeliveryExhaustedError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

function deriveEvent(
  source: CanonicalEvent,
  causationId: string,
  eventType: string,
  actorType: string,
  payload: Record<string, unknown>,
  providerExtensions?: Record<string, unknown>,
): CanonicalEvent {
  const event: CanonicalEvent = {
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
    actor_type: actorType,
    payload,
  };
  if (providerExtensions !== undefined) {
    event.provider_extensions = providerExtensions;
  }
  return event;
}

export class DeliveryOrchestrator {
  private readonly retryConfig: Required<RetryConfig>;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    retryConfig?: RetryConfig,
  ) {
    this.retryConfig = {
      maxRetries: retryConfig?.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseDelayMs: retryConfig?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    };
  }

  static async create(retryConfig?: RetryConfig): Promise<DeliveryOrchestrator> {
    const validators = await ContractHarnessValidators.create();
    return new DeliveryOrchestrator(validators, retryConfig);
  }

  async deliver(
    agentResponseCompleted: CanonicalEvent,
    sendFn: SendFn,
  ): Promise<DeliveryResult> {
    if (agentResponseCompleted.event_type !== "agent.response.completed") {
      throw new Error(`Expected agent.response.completed, got ${agentResponseCompleted.event_type}`);
    }

    const responseText = agentResponseCompleted.payload["text"];
    if (typeof responseText !== "string") {
      throw new Error("agent.response.completed payload must contain text");
    }

    const sendRequestedEvent = deriveEvent(
      agentResponseCompleted,
      agentResponseCompleted.event_id,
      "message.send.requested",
      "system",
      { text: responseText },
    );
    this.assertValid(sendRequestedEvent);

    const sendResult = await this.sendWithRetry(sendFn, responseText);

    const sentEvent = deriveEvent(
      agentResponseCompleted,
      sendRequestedEvent.event_id,
      "message.sent",
      "channel_adapter",
      { provider_message_id: sendResult.providerMessageId },
      { webchat: { delivery_status: "sent" } },
    );
    this.assertValid(sentEvent);

    return {
      sendRequestedEvent,
      sentEvent,
      providerMessageId: sendResult.providerMessageId,
    };
  }

  private async sendWithRetry(
    sendFn: SendFn,
    text: string,
  ): Promise<{ providerMessageId: string }> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await sendFn(text);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new DeliveryExhaustedError(this.retryConfig.maxRetries + 1, lastError!);
  }

  private assertValid(event: CanonicalEvent): void {
    const result: ValidationResult = this.validators.validateEvent(event);
    if (!result.ok) {
      const details = result.failure.issues.map((i) => i.message).join("; ");
      throw new Error(`Delivery produced invalid ${event.event_type}: ${details}`);
    }
  }
}
