import type {
  CanonicalEvent,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelSender,
  ValidationResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { createWhatsAppSessionTracker } from "./session-tracker";
import type { CanonicalizationResult, IngressError, WhatsAppSessionTracker, WhatsAppWebhookPayload } from "./types";
import { createWhatsAppSender } from "./whatsapp-sender";

const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsAppIngress implements ChannelAdapter {
  readonly channelType = "whatsapp" as const;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly apiBase: string | undefined,
    private readonly sessionTracker: WhatsAppSessionTracker,
  ) {}

  static async create(
    phoneNumberId: string,
    accessToken: string,
    options?: { apiBase?: string; sessionTracker?: WhatsAppSessionTracker },
  ): Promise<WhatsAppIngress> {
    const validators = await ContractHarnessValidators.getShared();
    return new WhatsAppIngress(
      validators,
      phoneNumberId,
      accessToken,
      options?.apiBase,
      options?.sessionTracker ?? createWhatsAppSessionTracker(),
    );
  }

  describeCapabilities(): ChannelCapabilities {
    return {
      channel: "whatsapp",
      messaging: { text: true, attachments: false, reactions: false, threads: false },
      streaming: { progressiveUpdate: false, nativeStreaming: false },
      interactive: { buttons: false, menus: false, commands: false },
      delivery: { retry: true, chunking: false, edit: false },
    };
  }

  createSender(event: CanonicalEvent): ChannelSender {
    const sender = createWhatsAppSender(this.phoneNumberId, this.accessToken, {
      ...(this.apiBase !== undefined ? { apiBase: this.apiBase } : {}),
      sessionTracker: this.sessionTracker,
    });
    return {
      send: (text: string) =>
        sender.sendMessage(extractRecipient(event), text).then((r) => ({ providerMessageId: r.messageId })),
    };
  }

  canonicalize(raw: unknown): CanonicalizationResult {
    const payload = validatePayload(raw);
    if (!payload.ok) return { ok: false, error: payload.error };

    const change = payload.payload.entry[0]?.changes[0];
    const entry = payload.payload.entry[0];
    const value = change?.value;
    if (!entry || !change || !value) {
      return {
        ok: false,
        error: { code: "invalid_payload", message: "Missing entry/change/value in WhatsApp payload" },
      };
    }

    const message = value.messages?.[0];
    if (message) {
      const conversationId = `wa_${value.metadata?.phone_number_id ?? this.phoneNumberId}_${message.from}`;
      const sessionWindowExpiresAt = new Date(
        Number(message.timestamp) * 1000 + WHATSAPP_SESSION_WINDOW_MS,
      ).toISOString();
      this.sessionTracker.record({ recipient: message.from, expiresAt: sessionWindowExpiresAt });

      const event: CanonicalEvent = {
        event_id: `evt_${crypto.randomUUID()}`,
        schema_version: "v1alpha1",
        event_type: "message.received",
        tenant_id: entry.id,
        workspace_id: value.metadata?.display_phone_number ?? this.phoneNumberId,
        channel: "whatsapp",
        channel_instance_id: value.metadata?.phone_number_id ?? this.phoneNumberId,
        conversation_id: conversationId,
        session_id: conversationId,
        correlation_id: `corr_${crypto.randomUUID()}`,
        occurred_at: new Date(Number(message.timestamp) * 1000).toISOString(),
        actor_type: "end_user",
        actor: { id: message.from },
        identity_refs: { channel_user_id: message.from },
        payload: { text: message.text.body },
        provider_extensions: {
          whatsapp: {
            from: message.from,
            message_id: message.id,
            phone_number_id: value.metadata?.phone_number_id,
            display_phone_number: value.metadata?.display_phone_number,
            session_window_expires_at: sessionWindowExpiresAt,
          },
        },
      };

      const validation: ValidationResult = this.validators.validateEvent(event);
      if (!validation.ok) {
        return {
          ok: false,
          error: {
            code: "contract_violation",
            message: `Canonicalized WhatsApp event failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
          },
        };
      }

      return { ok: true, event, idempotencyKey: `wa-${message.id}` };
    }

    const status = value.statuses?.[0];
    if (status) {
      const conversationId = `wa_${value.metadata?.phone_number_id ?? this.phoneNumberId}_${status.recipient_id}`;
      const event: CanonicalEvent = {
        event_id: `evt_${crypto.randomUUID()}`,
        schema_version: "v1alpha1",
        event_type: "agent.status.changed",
        tenant_id: entry.id,
        workspace_id: value.metadata?.display_phone_number ?? this.phoneNumberId,
        channel: "whatsapp",
        channel_instance_id: value.metadata?.phone_number_id ?? this.phoneNumberId,
        conversation_id: conversationId,
        session_id: conversationId,
        correlation_id: `corr_${crypto.randomUUID()}`,
        occurred_at: new Date(Number(status.timestamp) * 1000).toISOString(),
        actor: { id: "car_runtime" },
        actor_type: "system",
        payload: {
          status: mapWhatsAppStatus(status.status),
          session_handle: status.id,
          message: `WhatsApp delivery status: ${status.status}`,
          recipient_id: status.recipient_id,
          message_id: status.id,
          provider_status: status.status,
        },
        provider_extensions: {
          whatsapp: {
            recipient_id: status.recipient_id,
            message_id: status.id,
            phone_number_id: value.metadata?.phone_number_id,
            provider_status: status.status,
          },
        },
      };

      const validation: ValidationResult = this.validators.validateEvent(event);
      if (!validation.ok) {
        return {
          ok: false,
          error: {
            code: "contract_violation",
            message: `Canonicalized WhatsApp status event failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
          },
        };
      }

      return { ok: true, event, idempotencyKey: `wa-status-${status.id}-${status.status}` };
    }

    return {
      ok: false,
      error: { code: "unsupported_payload", message: "WhatsApp payload has no supported messages or statuses" },
    };
  }
}

function extractRecipient(event: CanonicalEvent): string {
  const wa = event.provider_extensions?.["whatsapp"] as Record<string, unknown> | undefined;
  const from = wa?.["from"];
  if (typeof from !== "string" || !from) {
    throw new Error("Cannot extract WhatsApp recipient from provider_extensions.whatsapp.from");
  }
  return from;
}

function mapWhatsAppStatus(status: string): "submitted" | "working" | "completed" | "failed" {
  switch (status) {
    case "sent":
      return "submitted";
    case "delivered":
      return "working";
    case "read":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "working";
  }
}

function validatePayload(
  raw: unknown,
): { ok: true; payload: WhatsAppWebhookPayload } | { ok: false; error: IngressError } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { code: "invalid_payload", message: "Request body must be a non-null object" } };
  }

  const obj = raw as Record<string, unknown>;
  if (obj["object"] !== "whatsapp_business_account") {
    return { ok: false, error: { code: "invalid_payload", message: "object must be whatsapp_business_account" } };
  }
  if (!Array.isArray(obj["entry"]) || obj["entry"].length === 0) {
    return { ok: false, error: { code: "invalid_payload", message: "entry must be a non-empty array" } };
  }

  return { ok: true, payload: raw as WhatsAppWebhookPayload };
}
