import type {
  CanonicalEvent,
  CanonicalizationResult,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelSender,
  ValidationResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { createLarkSender } from "./lark-sender";
import type { LarkEventWrapper, LarkMessageEvent } from "./types";

export class LarkIngress implements ChannelAdapter {
  readonly channelType = "lark" as const;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly tenantId: string,
    private readonly workspaceId: string,
    private readonly apiBase: string | undefined,
  ) {}

  static async create(
    appId: string,
    appSecret: string,
    tenantId: string,
    workspaceId: string,
    options?: { apiBase?: string },
  ): Promise<LarkIngress> {
    const validators = await ContractHarnessValidators.getShared();
    return new LarkIngress(validators, appId, appSecret, tenantId, workspaceId, options?.apiBase);
  }

  describeCapabilities(): ChannelCapabilities {
    return {
      channel: "lark",
      messaging: { text: true, attachments: false, reactions: false, threads: false },
      streaming: { progressiveUpdate: true, nativeStreaming: false },
      interactive: { buttons: false, menus: false, commands: false },
      delivery: { retry: true, chunking: false, edit: true },
    };
  }

  createSender(event: CanonicalEvent): ChannelSender {
    const lark = event.provider_extensions?.["lark"] as Record<string, unknown> | undefined;
    const chatId = (lark?.["chat_id"] ?? event.channel_instance_id?.replace("lark-", "")) as string;
    const messageId = lark?.["message_id"] as string | undefined;
    const sender = createLarkSender(
      this.appId,
      this.appSecret,
      this.apiBase !== undefined ? { apiBase: this.apiBase } : undefined,
    );
    const base: ChannelSender = {
      send: (text: string) => sender.sendMessage(chatId, text).then((r) => ({ providerMessageId: r.messageId })),
    };
    if (messageId) {
      base.edit = (providerMessageId: string, text: string) => sender.editMessage(providerMessageId, text);
    }
    return base;
  }

  canonicalize(raw: unknown): CanonicalizationResult {
    if (!isLarkEventWrapper(raw)) {
      return { ok: false, error: { code: "invalid_lark_event", message: "Not a valid Lark event wrapper" } };
    }

    if (raw.header.event_type !== "im.message.receive_v1") {
      return {
        ok: false,
        error: { code: "unsupported_event_type", message: `Unsupported event type: ${raw.header.event_type}` },
      };
    }

    if (!isLarkMessageEvent(raw.event)) {
      return {
        ok: false,
        error: { code: "invalid_message_event", message: "Event body is not a valid message event" },
      };
    }

    const msg = raw.event as unknown as LarkMessageEvent;

    if (msg.sender.sender_type === "bot" || msg.sender.sender_type === "app") {
      return { ok: false, error: { code: "bot_message", message: "Ignoring bot/app message" } };
    }

    if (msg.message.message_type !== "text") {
      return {
        ok: false,
        error: {
          code: "unsupported_message_type",
          message: `Only text messages are supported, got: ${msg.message.message_type}`,
        },
      };
    }

    let text: string;
    try {
      const parsed = JSON.parse(msg.message.content) as Record<string, unknown>;
      if (typeof parsed["text"] !== "string" || parsed["text"].length === 0) {
        return { ok: false, error: { code: "empty_text", message: "Message text is empty" } };
      }
      text = parsed["text"];
    } catch {
      return { ok: false, error: { code: "invalid_content", message: "Failed to parse message content JSON" } };
    }

    const chatId = msg.message.chat_id;
    const senderId = msg.sender.sender_id.open_id;
    const channelInstanceId = `lark-${chatId}`;
    const conversationId = `lark-chat-${chatId}`;
    const idempotencyKey = `lark-${raw.header.event_id}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "lark",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: conversationId,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date(Number(raw.header.create_time)).toISOString(),
      actor_type: "end_user",
      actor: { id: senderId },
      identity_refs: { channel_user_id: senderId },
      payload: { text },
      provider_extensions: {
        lark: {
          event_id: raw.header.event_id,
          message_id: msg.message.message_id,
          chat_id: chatId,
          chat_type: msg.message.chat_type,
          tenant_key: raw.header.tenant_key,
          app_id: raw.header.app_id,
          ...(msg.message.mentions !== undefined ? { mentions: msg.message.mentions } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Lark event failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }
}

function isLarkEventWrapper(raw: unknown): raw is LarkEventWrapper {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["schema"] !== "string") return false;
  const header = obj["header"];
  if (typeof header !== "object" || header === null) return false;
  const h = header as Record<string, unknown>;
  return (
    typeof h["event_id"] === "string" &&
    typeof h["event_type"] === "string" &&
    typeof h["create_time"] === "string" &&
    typeof h["token"] === "string" &&
    typeof h["app_id"] === "string" &&
    typeof h["tenant_key"] === "string"
  );
}

function isLarkMessageEvent(event: Record<string, unknown>): boolean {
  const sender = event["sender"];
  if (typeof sender !== "object" || sender === null) return false;
  const s = sender as Record<string, unknown>;
  const senderId = s["sender_id"];
  if (typeof senderId !== "object" || senderId === null) return false;
  if (typeof (senderId as Record<string, unknown>)["open_id"] !== "string") return false;
  if (typeof s["sender_type"] !== "string") return false;

  const message = event["message"];
  if (typeof message !== "object" || message === null) return false;
  const m = message as Record<string, unknown>;
  return (
    typeof m["message_id"] === "string" &&
    typeof m["chat_id"] === "string" &&
    typeof m["chat_type"] === "string" &&
    typeof m["message_type"] === "string" &&
    typeof m["content"] === "string"
  );
}
