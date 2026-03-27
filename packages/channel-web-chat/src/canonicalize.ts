import type { CanonicalEvent, ValidationResult } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { deriveIdempotencyKey } from "./idempotency";
import type { CanonicalizationResult, IngressError } from "./types";
import { validateInboundInput } from "./validate-input";

export class WebChatIngress {
  private constructor(private readonly validators: ContractHarnessValidators) {}

  static async create(): Promise<WebChatIngress> {
    const validators = await ContractHarnessValidators.create();
    return new WebChatIngress(validators);
  }

  canonicalize(raw: unknown): CanonicalizationResult {
    const inputResult = validateInboundInput(raw);

    if (!inputResult.ok) {
      return { ok: false, error: inputResult.error };
    }

    const request = inputResult.request;
    const idempotencyKey = deriveIdempotencyKey(request);

    const eventId = `evt_${crypto.randomUUID()}`;
    const correlationId = `corr_${crypto.randomUUID()}`;
    const conversationId = request.conversation_id ?? `conv_${crypto.randomUUID()}`;
    const sessionId = request.session_id ?? `sess_${crypto.randomUUID()}`;

    const event: CanonicalEvent = {
      event_id: eventId,
      schema_version: "v1alpha1",
      event_type: "message.received",
      tenant_id: request.tenant_id,
      workspace_id: request.workspace_id,
      channel: "webchat",
      channel_instance_id: request.channel_instance_id,
      conversation_id: conversationId,
      session_id: sessionId,
      correlation_id: correlationId,
      occurred_at: new Date().toISOString(),
      actor: {
        id: request.user_id,
        ...(request.display_name !== undefined ? { display_name: request.display_name } : {}),
      },
      actor_type: "end_user",
      identity_refs: {
        channel_user_id: request.user_id,
      },
      payload: {
        text: request.text,
      },
      provider_extensions: {
        webchat: {
          client_message_id: request.client_message_id,
        },
      },
    };

    if (request.trace_id !== undefined) {
      const traceContext: Record<string, string> = { trace_id: request.trace_id };
      if (request.span_id !== undefined) {
        traceContext["span_id"] = request.span_id;
      }
      if (request.parent_span_id !== undefined) {
        traceContext["parent_span_id"] = request.parent_span_id;
      }
      (event as Record<string, unknown>)["trace_context"] = traceContext;
    }

    const validationResult: ValidationResult = this.validators.validateEvent(event);

    if (!validationResult.ok) {
      const contractError: IngressError = {
        code: "contract_violation",
        message: `Canonicalized event failed ${validationResult.failure.step} validation: ${validationResult.failure.issues.map((i) => i.message).join("; ")}`,
      };
      return { ok: false, error: contractError };
    }

    return { ok: true, event, idempotencyKey };
  }
}
