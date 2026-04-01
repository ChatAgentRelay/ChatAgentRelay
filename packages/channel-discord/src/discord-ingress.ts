import type {
  CanonicalEvent,
  CanonicalizationResult,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelSender,
  ValidationResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { DiscordSender } from "./discord-sender";
import type {
  DiscordInteraction,
  DiscordMessageDeleteEvent,
  DiscordMessageEvent,
  DiscordMessageUpdateEvent,
  DiscordReactionEvent,
} from "./types";

export type DiscordCanonicalizationSuccess = {
  ok: true;
  event: CanonicalEvent;
  idempotencyKey: string;
};

export type DiscordCanonicalizationFailure = {
  ok: false;
  error: { code: string; message: string };
};

export type DiscordCanonicalizationResult = DiscordCanonicalizationSuccess | DiscordCanonicalizationFailure;

export class DiscordIngress implements ChannelAdapter {
  readonly channelType = "discord" as const;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    readonly sender: DiscordSender,
    private readonly tenantId: string,
    private readonly workspaceId: string,
  ) {}

  static async create(
    botToken: string,
    tenantId: string,
    workspaceId: string,
    options?: { apiBase?: string },
  ): Promise<DiscordIngress> {
    const validators = await ContractHarnessValidators.getShared();
    const sender = new DiscordSender({ token: botToken, apiBase: options?.apiBase });
    return new DiscordIngress(validators, sender, tenantId, workspaceId);
  }

  describeCapabilities(): ChannelCapabilities {
    return {
      channel: "discord",
      messaging: { text: true, attachments: false, reactions: true, threads: true },
      streaming: { progressiveUpdate: true, nativeStreaming: false },
      interactive: { buttons: false, menus: false, commands: true },
      delivery: { retry: true, chunking: true, edit: true },
    };
  }

  createSender(event: CanonicalEvent): ChannelSender {
    const discord = event.provider_extensions?.["discord"] as Record<string, unknown> | undefined;
    const channelId = (discord?.["channel_id"] ?? event.channel_instance_id?.replace("discord-", "")) as string;
    const messageId = discord?.["message_id"] as string | undefined;
    return {
      send: (text: string) => this.sender.send(channelId, text, messageId),
      edit: (providerMessageId: string, text: string) => this.sender.update(channelId, providerMessageId, text),
    };
  }

  canonicalize(raw: unknown): CanonicalizationResult {
    if (isDiscordReactionEvent(raw)) return this.canonicalizeReaction(raw);
    if (isDiscordInteraction(raw)) return this.canonicalizeCommand(raw);
    if (isDiscordMessageEvent(raw)) return this.canonicalizeMessageCreate(raw);

    const obj = raw as Record<string, unknown>;
    if (typeof obj?.["edited_timestamp"] === "string") return this.canonicalizeMessageUpdate(raw);
    if (typeof obj?.["id"] === "string" && typeof obj?.["channel_id"] === "string") {
      return this.canonicalizeMessageDelete(raw);
    }

    return { ok: false, error: { code: "invalid_discord_event", message: "Unrecognized Discord event shape" } };
  }

  private canonicalizeMessageCreate(raw: DiscordMessageEvent): CanonicalizationResult {
    if (raw.author.bot === true) {
      return { ok: false, error: { code: "bot_message", message: `Ignoring bot message from author: ${raw.author.id}` } };
    }

    if (!raw.content || raw.content.trim().length === 0) {
      return { ok: false, error: { code: "empty_content", message: "Message content is empty" } };
    }

    const isThread = raw.message_reference !== undefined || raw.thread !== undefined;
    const isDM = raw.guild_id === undefined;

    let conversationId: string;
    if (isThread) {
      conversationId = `discord:thread:${raw.channel_id}`;
    } else if (isDM) {
      conversationId = `discord:dm:${raw.channel_id}`;
    } else {
      conversationId = `discord:channel:${raw.channel_id}`;
    }

    const channelInstanceId = raw.guild_id !== undefined ? `discord_guild_${raw.guild_id}` : `discord_dm_${raw.channel_id}`;
    const idempotencyKey = `discord:${this.tenantId}:${raw.id}`;
    const sessionId = `discord_sess_${raw.author.id}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "discord",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: sessionId,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date(raw.timestamp).toISOString(),
      actor_type: "end_user",
      actor: { id: raw.author.id, display_name: raw.author.username },
      identity_refs: { channel_user_id: raw.author.id },
      payload: { text: raw.content },
      provider_extensions: {
        discord: {
          message_id: raw.id,
          channel_id: raw.channel_id,
          ...(raw.guild_id !== undefined ? { guild_id: raw.guild_id } : {}),
          ...(raw.message_reference !== undefined ? { message_reference: raw.message_reference } : {}),
          ...(raw.thread !== undefined ? { thread: raw.thread } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Discord event failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }

  canonicalizeCommand(raw: unknown): DiscordCanonicalizationResult {
    if (!isDiscordInteraction(raw)) {
      return { ok: false, error: { code: "invalid_interaction", message: "Not a valid Discord interaction" } };
    }

    if (raw.type !== 2) {
      return {
        ok: false,
        error: { code: "unsupported_interaction_type", message: `Expected APPLICATION_COMMAND (type=2), got type=${raw.type}` },
      };
    }

    if (!raw.data) {
      return { ok: false, error: { code: "missing_interaction_data", message: "Interaction is missing command data" } };
    }

    const user = raw.member?.user ?? raw.user;
    if (!user) {
      return { ok: false, error: { code: "missing_user", message: "Cannot determine user from interaction" } };
    }

    const args: Record<string, string | number | boolean> = {};
    const textParts: string[] = [];
    if (raw.data.options) {
      for (const opt of raw.data.options) {
        args[opt.name] = opt.value;
        textParts.push(String(opt.value));
      }
    }

    const channelInstanceId = raw.guild_id !== undefined
      ? `discord_guild_${raw.guild_id}`
      : `discord_dm_${raw.channel_id}`;
    const conversationId = raw.guild_id !== undefined
      ? `discord:cmd:${raw.guild_id}:${raw.channel_id}`
      : `discord:cmd:dm:${raw.channel_id}`;
    const idempotencyKey = `discord:${this.tenantId}:interaction:${raw.id}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "command.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "discord",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `discord_sess_${user.id}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date().toISOString(),
      actor_type: "end_user",
      actor: { id: user.id, display_name: user.username },
      identity_refs: { channel_user_id: user.id },
      payload: {
        command_name: raw.data.name,
        text: textParts.join(" "),
        arguments: args,
      },
      provider_extensions: {
        discord: {
          interaction_id: raw.id,
          interaction_token: raw.token,
          application_id: raw.application_id,
          ...(raw.guild_id !== undefined ? { guild_id: raw.guild_id } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Discord command event failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }

  canonicalizeMessageUpdate(raw: unknown): DiscordCanonicalizationResult {
    if (!isDiscordMessageUpdateEvent(raw)) {
      return { ok: false, error: { code: "invalid_message_update", message: "Not a valid Discord MESSAGE_UPDATE event" } };
    }

    const channelInstanceId = raw.guild_id !== undefined ? `discord_guild_${raw.guild_id}` : `discord_dm_${raw.channel_id}`;
    const idempotencyKey = `discord:${this.tenantId}:edit:${raw.id}:${raw.edited_timestamp ?? Date.now()}`;
    const conversationId = raw.guild_id !== undefined ? `discord:channel:${raw.channel_id}` : `discord:dm:${raw.channel_id}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.updated",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "discord",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `discord_sess_${raw.author?.id ?? "unknown"}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: raw.edited_timestamp ? new Date(raw.edited_timestamp).toISOString() : new Date().toISOString(),
      actor_type: "end_user",
      ...(raw.author !== undefined ? { actor: { id: raw.author.id, display_name: raw.author.username } } : {}),
      ...(raw.author !== undefined ? { identity_refs: { channel_user_id: raw.author.id } } : {}),
      payload: {
        original_message_id: raw.id,
        new_text: raw.content ?? "",
      },
      provider_extensions: {
        discord: {
          message_id: raw.id,
          channel_id: raw.channel_id,
          ...(raw.guild_id !== undefined ? { guild_id: raw.guild_id } : {}),
          ...(raw.edited_timestamp !== undefined ? { edited_timestamp: raw.edited_timestamp } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Discord message update failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }

  canonicalizeMessageDelete(raw: unknown): DiscordCanonicalizationResult {
    if (!isDiscordMessageDeleteEvent(raw)) {
      return { ok: false, error: { code: "invalid_message_delete", message: "Not a valid Discord MESSAGE_DELETE event" } };
    }

    const channelInstanceId = raw.guild_id !== undefined ? `discord_guild_${raw.guild_id}` : `discord_dm_${raw.channel_id}`;
    const idempotencyKey = `discord:${this.tenantId}:delete:${raw.id}`;
    const conversationId = raw.guild_id !== undefined ? `discord:channel:${raw.channel_id}` : `discord:dm:${raw.channel_id}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.deleted",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "discord",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `discord_sess_system`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date().toISOString(),
      actor_type: "system",
      payload: {
        deleted_message_id: raw.id,
      },
      provider_extensions: {
        discord: {
          message_id: raw.id,
          channel_id: raw.channel_id,
          ...(raw.guild_id !== undefined ? { guild_id: raw.guild_id } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Discord message delete failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }

  canonicalizeReaction(raw: unknown): DiscordCanonicalizationResult {
    if (!isDiscordReactionEvent(raw)) {
      return { ok: false, error: { code: "invalid_reaction", message: "Not a valid Discord reaction event" } };
    }

    const channelInstanceId = raw.guild_id !== undefined ? `discord_guild_${raw.guild_id}` : `discord_dm_${raw.channel_id}`;
    const idempotencyKey = `discord:${this.tenantId}:reaction:${raw.message_id}:${raw.emoji.name}:${raw.user_id}`;
    const conversationId = raw.guild_id !== undefined ? `discord:channel:${raw.channel_id}` : `discord:dm:${raw.channel_id}`;
    const emojiStr = raw.emoji.id ? `${raw.emoji.name}:${raw.emoji.id}` : raw.emoji.name;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "reaction.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "discord",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `discord_sess_${raw.user_id}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date().toISOString(),
      actor_type: "end_user",
      actor: { id: raw.user_id },
      identity_refs: { channel_user_id: raw.user_id },
      payload: {
        emoji: emojiStr,
        target_message_id: raw.message_id,
        action: "added",
      },
      provider_extensions: {
        discord: {
          message_id: raw.message_id,
          channel_id: raw.channel_id,
          emoji: raw.emoji,
          ...(raw.guild_id !== undefined ? { guild_id: raw.guild_id } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Discord reaction failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }
}

function isDiscordInteraction(raw: unknown): raw is DiscordInteraction {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["type"] === "number" &&
    typeof obj["channel_id"] === "string" &&
    typeof obj["token"] === "string" &&
    typeof obj["application_id"] === "string"
  );
}

function isDiscordMessageEvent(raw: unknown): raw is DiscordMessageEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["id"] !== "string") return false;
  if (typeof obj["channel_id"] !== "string") return false;
  if (typeof obj["content"] !== "string") return false;
  if (typeof obj["timestamp"] !== "string") return false;
  if (typeof obj["author"] !== "object" || obj["author"] === null) return false;
  const author = obj["author"] as Record<string, unknown>;
  if (typeof author["id"] !== "string") return false;
  if (typeof author["username"] !== "string") return false;
  return true;
}

function isDiscordMessageUpdateEvent(raw: unknown): raw is DiscordMessageUpdateEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return typeof obj["id"] === "string" && typeof obj["channel_id"] === "string";
}

function isDiscordMessageDeleteEvent(raw: unknown): raw is DiscordMessageDeleteEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return typeof obj["id"] === "string" && typeof obj["channel_id"] === "string";
}

function isDiscordReactionEvent(raw: unknown): raw is DiscordReactionEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["user_id"] !== "string") return false;
  if (typeof obj["channel_id"] !== "string") return false;
  if (typeof obj["message_id"] !== "string") return false;
  const emoji = obj["emoji"];
  if (typeof emoji !== "object" || emoji === null) return false;
  const e = emoji as Record<string, unknown>;
  return typeof e["name"] === "string";
}
