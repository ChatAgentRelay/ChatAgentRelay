import type {
  ButtonAction,
  CanonicalEvent,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelSender,
  InboundAttachment,
  OutboundAttachment,
  ValidationResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { createTelegramSender } from "./telegram-sender";
import type {
  CanonicalizationResult,
  IngressError,
  TelegramMessage,
  TelegramUpdate,
} from "./types";

export class TelegramIngress implements ChannelAdapter {
  readonly channelType = "telegram" as const;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    private readonly botToken: string,
    private readonly tenantId: string,
    private readonly workspaceId: string,
    private readonly apiBase: string | undefined,
  ) {}

  static async create(
    botToken: string,
    tenantId: string,
    workspaceId: string,
    options?: { apiBase?: string },
  ): Promise<TelegramIngress> {
    const validators = await ContractHarnessValidators.getShared();
    return new TelegramIngress(validators, botToken, tenantId, workspaceId, options?.apiBase);
  }

  describeCapabilities(): ChannelCapabilities {
    return {
      channel: "telegram",
      messaging: { text: true, attachments: true, reactions: false, threads: false },
      streaming: { progressiveUpdate: true, nativeStreaming: false },
      interactive: { buttons: true, menus: false, commands: true },
      delivery: { retry: true, chunking: false, edit: true },
    };
  }

  createSender(event: CanonicalEvent): ChannelSender {
    const tg = event.provider_extensions?.["telegram"] as Record<string, unknown> | undefined;
    const chatId = (tg?.["chat_id"] ?? event.channel_instance_id?.replace("telegram-", "")) as number | string;
    const api = createTelegramSender(
      this.botToken,
      this.apiBase !== undefined ? { apiBase: this.apiBase } : undefined,
    );
    return {
      send: (text: string) =>
        api.sendMessage(chatId, text).then((r) => ({ providerMessageId: String(r.messageId) })),
      sendRichMessage: (message) =>
        api.sendRichMessage(chatId, message).then((r) => ({ providerMessageId: String(r.messageId) })),
      edit: (providerMessageId: string, text: string) => api.editMessage(chatId, Number(providerMessageId), text),
      sendTyping: () => api.sendTyping(chatId),
      sendAttachment: (attachment: OutboundAttachment) => {
        const text = attachment.uri
          ? `${attachment.name}\n${attachment.uri}`
          : `Attachment: ${attachment.name} (${attachment.mimeType})`;
        return api.sendMessage(chatId, text).then((r) => ({ providerMessageId: String(r.messageId) }));
      },
      sendButtons: (text: string, buttons: ButtonAction[]) =>
        api.sendButtons(chatId, text, buttons).then((r) => ({ providerMessageId: String(r.messageId) })),
    };
  }

  canonicalize(raw: unknown): CanonicalizationResult {
    const updateResult = validateTelegramUpdate(raw);
    if (!updateResult.ok) {
      return { ok: false, error: updateResult.error };
    }

    const update = updateResult.update;
    const message = update.message!;
    const from = message.from!;

    if (from.is_bot) {
      return { ok: false, error: { code: "bot_message", message: "Ignoring message from bot user" } };
    }

    const isCommand = hasCommandEntity(message);
    const eventType = isCommand ? "command.received" : "message.received";

    const displayName = from.first_name + (from.last_name ? ` ${from.last_name}` : "");
    const channelInstanceId = `telegram-${message.chat.id}`;
    const conversationId = `tg-chat-${message.chat.id}`;
    const idempotencyKey = `tg-${update.update_id}`;

    const messageText = typeof message.text === "string" ? message.text : "";
    const attachments = telegramMessageToInboundAttachments(message);
    const basePayload: Record<string, unknown> = isCommand
      ? buildCommandPayload(messageText)
      : {
          text: messageText,
          ...(attachments.length > 0 ? { attachments } : {}),
        };

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: eventType,
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "telegram",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: conversationId,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date(message.date * 1000).toISOString(),
      actor_type: "end_user",
      actor: {
        id: String(from.id),
        display_name: displayName,
        ...(from.username !== undefined ? { username: from.username } : {}),
      },
      identity_refs: { channel_user_id: String(from.id) },
      payload: basePayload,
      provider_extensions: {
        telegram: {
          update_id: update.update_id,
          message_id: message.message_id,
          chat_id: message.chat.id,
          chat_type: message.chat.type,
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      const contractError: IngressError = {
        code: "contract_violation",
        message: `Canonicalized Telegram event failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
      };
      return { ok: false, error: contractError };
    }

    return { ok: true, event, idempotencyKey };
  }
}

function telegramMessageToInboundAttachments(message: TelegramMessage): InboundAttachment[] {
  const attachments: InboundAttachment[] = [];

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((a, b) => ((a.width * a.height) >= (b.width * b.height) ? a : b));
    attachments.push({
      attachment_id: largest.file_id,
      kind: "image",
      mime_type: "image/jpeg",
      ...(largest.file_size !== undefined ? { size_bytes: largest.file_size } : {}),
    });
  }

  if (message.document) {
    attachments.push({
      attachment_id: message.document.file_id,
      kind: "file",
      ...(message.document.mime_type ? { mime_type: message.document.mime_type } : {}),
      ...(message.document.file_name ? { filename: message.document.file_name } : {}),
      ...(message.document.file_size !== undefined ? { size_bytes: message.document.file_size } : {}),
    });
  }

  if (message.video) {
    attachments.push({
      attachment_id: message.video.file_id,
      kind: "video",
      ...(message.video.mime_type ? { mime_type: message.video.mime_type } : {}),
      ...(message.video.file_name ? { filename: message.video.file_name } : {}),
      ...(message.video.file_size !== undefined ? { size_bytes: message.video.file_size } : {}),
    });
  }

  if (message.audio) {
    attachments.push({
      attachment_id: message.audio.file_id,
      kind: "audio",
      ...(message.audio.mime_type ? { mime_type: message.audio.mime_type } : {}),
      ...(message.audio.file_name ? { filename: message.audio.file_name } : {}),
      ...(message.audio.file_size !== undefined ? { size_bytes: message.audio.file_size } : {}),
    });
  }

  if (message.voice) {
    attachments.push({
      attachment_id: message.voice.file_id,
      kind: "audio",
      ...(message.voice.mime_type ? { mime_type: message.voice.mime_type } : {}),
      ...(message.voice.file_size !== undefined ? { size_bytes: message.voice.file_size } : {}),
    });
  }

  return attachments;
}

function buildCommandPayload(text: string): Record<string, unknown> {
  const parts = text.trim().split(/\s+/);
  const commandRaw = parts[0]!;
  const commandName = commandRaw.startsWith("/") ? commandRaw.slice(1) : commandRaw;
  const commandText = parts.slice(1).join(" ");
  return { command_name: commandName, text: commandText, arguments: {} };
}

function hasCommandEntity(message: TelegramMessage): boolean {
  if (!message.entities || message.entities.length === 0) return false;
  return message.entities.some((e) => e.type === "bot_command" && e.offset === 0);
}

type UpdateValidationSuccess = { ok: true; update: TelegramUpdate };
type UpdateValidationFailure = { ok: false; error: IngressError };

function validateTelegramUpdate(raw: unknown): UpdateValidationSuccess | UpdateValidationFailure {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { code: "invalid_payload", message: "Request body must be a non-null object" } };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj["update_id"] !== "number") {
    return {
      ok: false,
      error: { code: "missing_field", message: "update_id is required and must be a number", field: "update_id" },
    };
  }

  const msg = obj["message"];
  if (typeof msg !== "object" || msg === null) {
    return { ok: false, error: { code: "missing_field", message: "message is required", field: "message" } };
  }

  const m = msg as Record<string, unknown>;

  if (typeof m["message_id"] !== "number") {
    return {
      ok: false,
      error: { code: "missing_field", message: "message.message_id is required", field: "message.message_id" },
    };
  }

  const from = m["from"];
  if (typeof from !== "object" || from === null) {
    return { ok: false, error: { code: "missing_field", message: "message.from is required", field: "message.from" } };
  }

  const f = from as Record<string, unknown>;
  if (typeof f["id"] !== "number") {
    return {
      ok: false,
      error: { code: "missing_field", message: "message.from.id is required", field: "message.from.id" },
    };
  }

  const chat = m["chat"];
  if (typeof chat !== "object" || chat === null) {
    return { ok: false, error: { code: "missing_field", message: "message.chat is required", field: "message.chat" } };
  }

  const c = chat as Record<string, unknown>;
  if (typeof c["id"] !== "number") {
    return {
      ok: false,
      error: { code: "missing_field", message: "message.chat.id is required", field: "message.chat.id" },
    };
  }

  const text = typeof m["text"] === "string" ? m["text"] : "";
  const hasMedia =
    (Array.isArray(m["photo"]) && m["photo"].length > 0) ||
    (typeof m["document"] === "object" && m["document"] !== null) ||
    (typeof m["video"] === "object" && m["video"] !== null) ||
    (typeof m["audio"] === "object" && m["audio"] !== null) ||
    (typeof m["voice"] === "object" && m["voice"] !== null);

  if (text.length === 0 && !hasMedia) {
    return {
      ok: false,
      error: {
        code: "missing_field",
        message: "message.text is required unless the message includes a photo, document, video, or audio attachment",
        field: "message.text",
      },
    };
  }

  if (typeof m["text"] !== "undefined" && typeof m["text"] !== "string") {
    return {
      ok: false,
      error: { code: "missing_field", message: "message.text must be a string when present", field: "message.text" },
    };
  }

  if (typeof m["date"] !== "number") {
    return { ok: false, error: { code: "missing_field", message: "message.date is required", field: "message.date" } };
  }

  return { ok: true, update: raw as TelegramUpdate };
}
