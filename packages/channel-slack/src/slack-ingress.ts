import type {
  CanonicalEvent,
  CanonicalizationResult,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelSender,
  ValidationResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SlackSender } from "./slack-sender";
import type {
  SlackAppMentionEvent,
  SlackMessageChangedEvent,
  SlackMessageDeletedEvent,
  SlackMessageEvent,
  SlackReactionEvent,
  SlackSlashCommandPayload,
} from "./types";

export type SlackCanonicalizationSuccess = {
  ok: true;
  event: CanonicalEvent;
  idempotencyKey: string;
};

export type SlackCanonicalizationFailure = {
  ok: false;
  error: { code: string; message: string };
};

export type SlackCanonicalizationResult = SlackCanonicalizationSuccess | SlackCanonicalizationFailure;

export class SlackIngress implements ChannelAdapter {
  readonly channelType = "slack" as const;

  private constructor(
    private readonly validators: ContractHarnessValidators,
    readonly sender: SlackSender,
    private readonly tenantId: string,
    private readonly workspaceId: string,
  ) {}

  static async create(
    botToken: string,
    tenantId: string,
    workspaceId: string,
    options?: { apiBase?: string },
  ): Promise<SlackIngress> {
    const validators = await ContractHarnessValidators.getShared();
    const sender = new SlackSender({ botToken, apiBase: options?.apiBase });
    return new SlackIngress(validators, sender, tenantId, workspaceId);
  }

  describeCapabilities(): ChannelCapabilities {
    return {
      channel: "slack",
      messaging: { text: true, attachments: false, reactions: true, threads: true },
      streaming: { progressiveUpdate: true, nativeStreaming: false },
      interactive: { buttons: false, menus: false, commands: true },
      delivery: { retry: true, chunking: true, edit: true },
    };
  }

  createSender(event: CanonicalEvent): ChannelSender {
    const slack = event.provider_extensions?.["slack"] as Record<string, unknown> | undefined;
    const channel =
      (typeof slack?.["channel_id"] === "string"
        ? slack["channel_id"]
        : typeof slack?.["channel"] === "string"
          ? slack["channel"]
          : typeof event.channel_instance_id === "string"
            ? event.channel_instance_id.replace(/^slack_/, "")
            : "") as string;
    const threadTs = typeof slack?.["thread_ts"] === "string" ? slack["thread_ts"] : undefined;
    return {
      send: (text: string) => this.sender.send(channel, text, threadTs),
      edit: (providerMessageId: string, text: string) => this.sender.update(channel, providerMessageId, text),
    };
  }

  canonicalize(raw: unknown): CanonicalizationResult {
    const inner = extractSlackInnerEvent(raw);

    if (!inner) {
      if (isSlackSlashCommandPayload(raw)) return this.canonicalizeCommand(raw);
      return { ok: false, error: { code: "invalid_slack_event", message: "Not a valid Slack event" } };
    }

    const eventType = inner["type"] as string | undefined;

    if (eventType === "reaction_added" || eventType === "reaction_removed") {
      return this.canonicalizeReaction(inner);
    }

    if (eventType === "message") {
      const subtype = (inner as Record<string, unknown>)["subtype"] as string | undefined;
      if (subtype === "message_changed") return this.canonicalizeMessageUpdate(inner);
      if (subtype === "message_deleted") return this.canonicalizeMessageDelete(inner);
      if (subtype !== undefined) {
        return { ok: false, error: { code: "unsupported_subtype", message: `Unsupported message subtype: ${subtype}` } };
      }
      if ((inner as Record<string, unknown>)["bot_id"] !== undefined) {
        return { ok: false, error: { code: "bot_message", message: "Ignoring bot message" } };
      }
    }

    return this.canonicalizeMessage(inner);
  }

  private canonicalizeMessage(raw: unknown): CanonicalizationResult {
    if (!isSlackMessageEvent(raw) && !isSlackAppMentionEvent(raw)) {
      return { ok: false, error: { code: "invalid_slack_event", message: "Not a valid Slack message event" } };
    }

    if (!raw.text || raw.text.trim().length === 0) {
      return { ok: false, error: { code: "empty_text", message: "Message text is empty" } };
    }

    const channelInstanceId = `slack_${raw.channel}`;
    const idempotencyKey = `slack:${this.tenantId}:${channelInstanceId}:${raw.ts}`;
    const threadTs = raw.type === "message" ? (raw as SlackMessageEvent).thread_ts : (raw as SlackAppMentionEvent).thread_ts;
    const conversationId = threadTs ? `slack_thread_${threadTs}` : `slack_${raw.channel}_${raw.ts}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "slack",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `slack_sess_${raw.user}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date(parseFloat(raw.ts) * 1000).toISOString(),
      actor_type: "end_user",
      actor: { id: raw.user },
      identity_refs: { channel_user_id: raw.user },
      payload: { text: raw.text },
      provider_extensions: {
        slack: {
          channel_id: raw.channel,
          ts: raw.ts,
          team_id: raw.type === "message" ? ((raw as SlackMessageEvent).team ?? "") : ((raw as SlackAppMentionEvent).team ?? ""),
          channel_type: raw.type === "message" ? ((raw as SlackMessageEvent).channel_type ?? "unknown") : ((raw as SlackAppMentionEvent).channel_type ?? "unknown"),
          event_type: raw.type,
          ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Slack event failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }

  canonicalizeMessageUpdate(raw: unknown): SlackCanonicalizationResult {
    if (!isSlackMessageChangedEvent(raw)) {
      return { ok: false, error: { code: "invalid_message_changed", message: "Not a valid Slack message_changed event" } };
    }

    const channelInstanceId = `slack_${raw.channel}`;
    const idempotencyKey = `slack:${this.tenantId}:edit:${raw.message.ts}:${raw.ts}`;
    const conversationId = `slack_${raw.channel}_${raw.message.ts}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.updated",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "slack",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `slack_sess_${raw.message.user}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date(parseFloat(raw.ts) * 1000).toISOString(),
      actor_type: "end_user",
      actor: { id: raw.message.user },
      identity_refs: { channel_user_id: raw.message.user },
      payload: {
        original_message_id: raw.message.ts,
        new_text: raw.message.text,
        ...(raw.previous_message?.text !== undefined ? { previous_text: raw.previous_message.text } : {}),
      },
      provider_extensions: {
        slack: {
          channel_id: raw.channel,
          ts: raw.ts,
          message_ts: raw.message.ts,
          ...(raw.message.edited !== undefined ? { edited: raw.message.edited } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Slack message update failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }

  canonicalizeMessageDelete(raw: unknown): SlackCanonicalizationResult {
    if (!isSlackMessageDeletedEvent(raw)) {
      return { ok: false, error: { code: "invalid_message_deleted", message: "Not a valid Slack message_deleted event" } };
    }

    const channelInstanceId = `slack_${raw.channel}`;
    const idempotencyKey = `slack:${this.tenantId}:delete:${raw.deleted_ts}:${raw.ts}`;
    const conversationId = `slack_${raw.channel}_${raw.deleted_ts}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "message.deleted",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "slack",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `slack_sess_${raw.previous_message?.user ?? "unknown"}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date(parseFloat(raw.ts) * 1000).toISOString(),
      actor_type: "system",
      payload: {
        deleted_message_id: raw.deleted_ts,
        ...(raw.previous_message?.text !== undefined ? { deleted_text: raw.previous_message.text } : {}),
      },
      provider_extensions: {
        slack: {
          channel_id: raw.channel,
          ts: raw.ts,
          deleted_ts: raw.deleted_ts,
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Slack message delete failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }

  canonicalizeReaction(raw: unknown): SlackCanonicalizationResult {
    if (!isSlackReactionEvent(raw)) {
      return { ok: false, error: { code: "invalid_reaction", message: "Not a valid Slack reaction event" } };
    }

    const channelInstanceId = `slack_${raw.item.channel}`;
    const idempotencyKey = `slack:${this.tenantId}:reaction:${raw.item.ts}:${raw.reaction}:${raw.event_ts}`;
    const conversationId = `slack_${raw.item.channel}_${raw.item.ts}`;
    const action = raw.type === "reaction_added" ? "added" : "removed";

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "reaction.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "slack",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `slack_sess_${raw.user}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date(parseFloat(raw.event_ts) * 1000).toISOString(),
      actor_type: "end_user",
      actor: { id: raw.user },
      identity_refs: { channel_user_id: raw.user },
      payload: {
        emoji: raw.reaction,
        target_message_id: raw.item.ts,
        action,
      },
      provider_extensions: {
        slack: {
          channel_id: raw.item.channel,
          event_ts: raw.event_ts,
          ...(raw.item_user !== undefined ? { item_user: raw.item_user } : {}),
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Slack reaction failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }

  canonicalizeCommand(raw: unknown): SlackCanonicalizationResult {
    if (!isSlackSlashCommandPayload(raw)) {
      return { ok: false, error: { code: "invalid_slash_command", message: "Not a valid Slack slash command payload" } };
    }

    const commandName = raw.command.startsWith("/") ? raw.command.slice(1) : raw.command;
    const channelInstanceId = `slack_${raw.channel_id}`;
    const conversationId = `slack_cmd_${raw.channel_id}_${Date.now()}`;
    const idempotencyKey = `slack:${this.tenantId}:cmd:${raw.trigger_id}`;

    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "command.received",
      tenant_id: this.tenantId,
      workspace_id: this.workspaceId,
      channel: "slack",
      channel_instance_id: channelInstanceId,
      conversation_id: conversationId,
      session_id: `slack_sess_${raw.user_id}`,
      correlation_id: `corr_${crypto.randomUUID()}`,
      occurred_at: new Date().toISOString(),
      actor_type: "end_user",
      actor: { id: raw.user_id, display_name: raw.user_name },
      identity_refs: { channel_user_id: raw.user_id },
      payload: { command_name: commandName, text: raw.text, arguments: {} },
      provider_extensions: {
        slack: {
          command: raw.command,
          response_url: raw.response_url,
          trigger_id: raw.trigger_id,
          channel_id: raw.channel_id,
          team_id: raw.team_id,
        },
      },
    };

    const validation: ValidationResult = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized Slack command event failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
        },
      };
    }

    return { ok: true, event, idempotencyKey };
  }
}

function extractSlackInnerEvent(raw: unknown): unknown | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;

  if (typeof obj["payload"] === "object" && obj["payload"] !== null) {
    const payload = obj["payload"] as Record<string, unknown>;
    if (typeof payload["event"] === "object" && payload["event"] !== null) {
      return payload["event"];
    }
  }

  if (typeof obj["type"] === "string") return obj;
  return undefined;
}

function isSlackSlashCommandPayload(raw: unknown): raw is SlackSlashCommandPayload {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj["command"] === "string" &&
    typeof obj["text"] === "string" &&
    typeof obj["user_id"] === "string" &&
    typeof obj["channel_id"] === "string" &&
    typeof obj["trigger_id"] === "string"
  );
}

function isSlackMessageEvent(raw: unknown): raw is SlackMessageEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj["type"] === "message" &&
    typeof obj["channel"] === "string" &&
    typeof obj["user"] === "string" &&
    typeof obj["text"] === "string" &&
    typeof obj["ts"] === "string"
  );
}

function isSlackAppMentionEvent(raw: unknown): raw is SlackAppMentionEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj["type"] === "app_mention" &&
    typeof obj["channel"] === "string" &&
    typeof obj["user"] === "string" &&
    typeof obj["text"] === "string" &&
    typeof obj["ts"] === "string"
  );
}

function isSlackMessageChangedEvent(raw: unknown): raw is SlackMessageChangedEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (obj["type"] !== "message" || obj["subtype"] !== "message_changed") return false;
  if (typeof obj["channel"] !== "string" || typeof obj["ts"] !== "string") return false;
  const msg = obj["message"];
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return typeof m["user"] === "string" && typeof m["text"] === "string" && typeof m["ts"] === "string";
}

function isSlackMessageDeletedEvent(raw: unknown): raw is SlackMessageDeletedEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj["type"] === "message" &&
    obj["subtype"] === "message_deleted" &&
    typeof obj["channel"] === "string" &&
    typeof obj["ts"] === "string" &&
    typeof obj["deleted_ts"] === "string"
  );
}

function isSlackReactionEvent(raw: unknown): raw is SlackReactionEvent {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (obj["type"] !== "reaction_added" && obj["type"] !== "reaction_removed") return false;
  if (typeof obj["user"] !== "string" || typeof obj["reaction"] !== "string") return false;
  if (typeof obj["event_ts"] !== "string") return false;
  const item = obj["item"];
  if (typeof item !== "object" || item === null) return false;
  const i = item as Record<string, unknown>;
  return i["type"] === "message" && typeof i["channel"] === "string" && typeof i["ts"] === "string";
}
