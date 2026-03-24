import type { CanonicalEvent, ValidationResult } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";
import type { SlackMessageEvent } from "./types";

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

export class SlackIngress {
  private constructor(
    private readonly validators: ContractHarnessValidators,
    private readonly tenantId: string,
    private readonly workspaceId: string,
  ) {}

  static async create(tenantId: string, workspaceId: string): Promise<SlackIngress> {
    const validators = await ContractHarnessValidators.create();
    return new SlackIngress(validators, tenantId, workspaceId);
  }

  canonicalize(raw: unknown): SlackCanonicalizationResult {
    if (!isSlackMessageEvent(raw)) {
      return { ok: false, error: { code: "invalid_slack_event", message: "Not a valid Slack message event" } };
    }

    if (raw.subtype !== undefined) {
      return { ok: false, error: { code: "unsupported_subtype", message: `Unsupported message subtype: ${raw.subtype}` } };
    }

    if (!raw.text || raw.text.trim().length === 0) {
      return { ok: false, error: { code: "empty_text", message: "Message text is empty" } };
    }

    const channelInstanceId = `slack_${raw.channel}`;
    const idempotencyKey = `slack:${this.tenantId}:${channelInstanceId}:${raw.ts}`;
    const conversationId = raw.thread_ts ? `slack_thread_${raw.thread_ts}` : `slack_${raw.channel}_${raw.ts}`;

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
          team_id: raw.team ?? "",
          channel_type: raw.channel_type ?? "unknown",
          ...(raw.thread_ts !== undefined ? { thread_ts: raw.thread_ts } : {}),
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
