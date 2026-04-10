import type {
  CanonicalEvent,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelSender,
  ValidationResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { createDingTalkSender } from "./dingtalk-sender";
import type { CanonicalizationResult, DingTalkRobotCallback, IngressError } from "./types";

export class DingTalkIngress implements ChannelAdapter {
  readonly channelType = "dingtalk" as const;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    private readonly tenantId: string,
    private readonly workspaceId: string,
  ) {}

  static async create(tenantId: string, workspaceId: string): Promise<DingTalkIngress> {
    const validators = await ContractHarnessValidators.getShared();
    return new DingTalkIngress(validators, tenantId, workspaceId);
  }

  describeCapabilities(): ChannelCapabilities {
    return {
      channel: "dingtalk",
      messaging: { text: true, attachments: false, reactions: false, threads: false },
      streaming: { progressiveUpdate: false, nativeStreaming: false },
      interactive: { buttons: false, menus: false, commands: false },
      delivery: { retry: true, chunking: false, edit: false },
    };
  }

  createSender(event: CanonicalEvent): ChannelSender {
    const dt = event.provider_extensions?.["dingtalk"] as Record<string, unknown> | undefined;
    const sessionWebhook = dt?.["session_webhook"] as string | undefined;
    const sender = createDingTalkSender();
    return {
      send: async (text: string) => {
        if (sessionWebhook) await sender.sendViaWebhook(sessionWebhook, text);
        return { providerMessageId: `dt_${Date.now()}` };
      },
    };
  }

  canonicalize(raw: unknown): CanonicalizationResult {
    const validated = validateCallback(raw);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }

    const cb = validated.callback;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "dingtalk",
      channel_instance_id: `dingtalk-${cb.conversationId}`,
      conversation_id: `dt-${cb.conversationId}`,
      session_id: `dt-${cb.conversationId}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date(cb.createAt).toISOString(),
      actor: {
        id: cb.senderId,
        display_name: cb.senderNick,
      },
      actor_type: "end_user",
      identity_refs: {
        channel_user_id: cb.senderId,
      },
      payload: {
        text: cb.text.content,
      },
      provider_extensions: {
        dingtalk: {
          msg_id: cb.msgId,
          conversation_type: cb.conversationType,
          ...(cb.conversationTitle !== undefined ? { conversation_title: cb.conversationTitle } : {}),
          ...(cb.senderStaffId !== undefined ? { sender_staff_id: cb.senderStaffId } : {}),
          ...(cb.isAdmin !== undefined ? { is_admin: cb.isAdmin } : {}),
          session_webhook: cb.sessionWebhook,
          chatbot_user_id: cb.chatbotUserId,
        },
      },
    };

    const validationResult: ValidationResult = this.validators.validateEvent(event);
    if (!validationResult.ok) {
      const contractError: IngressError = {
        code: "contract_violation",
        message: `Canonicalized event failed ${validationResult.failure.step} validation: ${validationResult.failure.issues.map((i) => i.message).join("; ")}`,
      };
      return { ok: false, error: contractError };
    }

    return { ok: true, event, idempotencyKey: `dt-${cb.msgId}` };
  }
}

type CallbackValidation = { ok: true; callback: DingTalkRobotCallback } | { ok: false; error: IngressError };

function validateCallback(raw: unknown): CallbackValidation {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: { code: "invalid_payload", message: "Request body must be a JSON object" } };
  }

  const body = raw as Record<string, unknown>;

  if (body["msgtype"] !== "text") {
    return {
      ok: false,
      error: {
        code: "unsupported_msgtype",
        message: `Only msgtype "text" is supported, got "${String(body["msgtype"])}"`,
        field: "msgtype",
      },
    };
  }

  const text = body["text"];
  if (text === null || typeof text !== "object" || typeof (text as Record<string, unknown>)["content"] !== "string") {
    return {
      ok: false,
      error: { code: "missing_field", message: "Missing or invalid text.content", field: "text.content" },
    };
  }

  const content = (text as Record<string, unknown>)["content"] as string;
  if (content.trim().length === 0) {
    return {
      ok: false,
      error: { code: "empty_content", message: "text.content must not be empty", field: "text.content" },
    };
  }

  for (const field of [
    "msgId",
    "senderId",
    "senderNick",
    "conversationId",
    "conversationType",
    "chatbotUserId",
    "sessionWebhook",
  ] as const) {
    if (typeof body[field] !== "string") {
      return { ok: false, error: { code: "missing_field", message: `Missing required field: ${field}`, field } };
    }
  }

  if (typeof body["createAt"] !== "number") {
    return {
      ok: false,
      error: { code: "missing_field", message: "Missing required field: createAt", field: "createAt" },
    };
  }

  if (typeof body["sessionWebhookExpiredTime"] !== "number") {
    return {
      ok: false,
      error: {
        code: "missing_field",
        message: "Missing required field: sessionWebhookExpiredTime",
        field: "sessionWebhookExpiredTime",
      },
    };
  }

  return { ok: true, callback: raw as DingTalkRobotCallback };
}
