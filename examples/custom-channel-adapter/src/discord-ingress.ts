/**
 * Skeleton "Discord-like" channel ingress — illustrates the CAP ChannelIngress pattern only.
 * Replace validation and field mapping with real Discord API / Gateway types in production.
 */

import type { CanonicalEvent, ValidationResult } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";

// ---------------------------------------------------------------------------
// Result types (same shape as @cap/channel-web-chat; structural typing matches conformance)
// ---------------------------------------------------------------------------

export type IngressError = {
  code: string;
  message: string;
  field?: string;
};

export type CanonicalizationSuccess = {
  ok: true;
  event: CanonicalEvent;
  idempotencyKey: string;
};

export type CanonicalizationFailure = {
  ok: false;
  error: IngressError;
};

export type CanonicalizationResult = CanonicalizationSuccess | CanonicalizationFailure;

// ---------------------------------------------------------------------------
// Inbound shape we pretend came from a Discord HTTP interaction / webhook payload
// ---------------------------------------------------------------------------

export type DiscordLikeInbound = {
  tenant_id: string;
  workspace_id: string;
  /** Logical bot installation / surface (your mapping, not necessarily Discord’s app id alone). */
  channel_instance_id: string;
  /** Discord message snowflake — stable and unique per channel. */
  message_id: string;
  channel_id: string;
  user_id: string;
  /** Message body (Discord calls this `content`). */
  content: string;
  username?: string;
  guild_id?: string;
};

type ParsedInbound = { ok: true; data: DiscordLikeInbound } | { ok: false; error: IngressError };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validationError(code: string, message: string, field?: string): CanonicalizationFailure {
  const error: IngressError = { code, message };
  if (field !== undefined) {
    error.field = field;
  }
  return { ok: false, error };
}

/**
 * Narrow `unknown` into our skeleton Discord-shaped record.
 * Pure validation — no I/O, no throws.
 */
function parseDiscordLikeInbound(raw: unknown): ParsedInbound {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: { code: "invalid_payload", message: "Body must be a non-null object" } };
  }

  const body = raw as Record<string, unknown>;

  if (!isNonEmptyString(body["tenant_id"])) {
    return {
      ok: false,
      error: { code: "missing_field", message: "tenant_id is required", field: "tenant_id" },
    };
  }
  if (!isNonEmptyString(body["workspace_id"])) {
    return {
      ok: false,
      error: { code: "missing_field", message: "workspace_id is required", field: "workspace_id" },
    };
  }
  if (!isNonEmptyString(body["channel_instance_id"])) {
    return {
      ok: false,
      error: {
        code: "missing_field",
        message: "channel_instance_id is required",
        field: "channel_instance_id",
      },
    };
  }
  if (!isNonEmptyString(body["message_id"])) {
    return {
      ok: false,
      error: { code: "missing_field", message: "message_id is required", field: "message_id" },
    };
  }
  if (!isNonEmptyString(body["channel_id"])) {
    return {
      ok: false,
      error: { code: "missing_field", message: "channel_id is required", field: "channel_id" },
    };
  }
  if (!isNonEmptyString(body["user_id"])) {
    return {
      ok: false,
      error: { code: "missing_field", message: "user_id is required", field: "user_id" },
    };
  }
  if (!isNonEmptyString(body["content"])) {
    return {
      ok: false,
      error: { code: "missing_field", message: "content is required and must be non-empty", field: "content" },
    };
  }

  const data: DiscordLikeInbound = {
    tenant_id: body["tenant_id"],
    workspace_id: body["workspace_id"],
    channel_instance_id: body["channel_instance_id"],
    message_id: body["message_id"],
    channel_id: body["channel_id"],
    user_id: body["user_id"],
    content: body["content"],
  };

  if (isNonEmptyString(body["username"])) {
    data.username = body["username"];
  }
  if (isNonEmptyString(body["guild_id"])) {
    data.guild_id = body["guild_id"];
  }

  return { ok: true, data };
}

/**
 * Stable dedupe key: provider namespace + tenant + immutable provider message id.
 * Same inbound payload must yield the same key across repeated deliveries.
 */
function deriveIdempotencyKey(data: DiscordLikeInbound): string {
  return `discord:${data.tenant_id}:${data.message_id}`;
}

export class DiscordIngress {
  private constructor(private readonly validators: ContractHarnessValidators) {}

  static async create(): Promise<DiscordIngress> {
    const validators = await ContractHarnessValidators.create();
    return new DiscordIngress(validators);
  }

  /**
   * ChannelIngress entrypoint: map arbitrary wire input to CanonicalizationResult.
   * MUST NOT throw — report all failures via `{ ok: false, error }`.
   */
  canonicalize(raw: unknown): CanonicalizationResult {
    const parsed = parseDiscordLikeInbound(raw);
    if (!parsed.ok) {
      return validationError(parsed.error.code, parsed.error.message, parsed.error.field);
    }

    const data = parsed.data;

    // -----------------------------------------------------------------------
    // Canonical identifiers: new UUIDs per successful canonicalization for event_id / correlation_id.
    // Idempotency for downstream dedupe uses deriveIdempotencyKey, not event_id.
    // -----------------------------------------------------------------------
    const eventId = `evt_${crypto.randomUUID()}`;
    const correlationId = `corr_${crypto.randomUUID()}`;
    const conversationId = `discord:channel:${data.channel_id}`;
    const sessionId = `discord:session:${data.channel_id}:${data.user_id}`;

    const actor: { id: string; display_name?: string } = { id: data.user_id };
    if (data.username !== undefined) {
      actor.display_name = data.username;
    }

    const event: CanonicalEvent = {
      event_id: eventId,
      schema_version: "v1alpha1",
      event_type: "message.received",
      tenant_id: data.tenant_id,
      workspace_id: data.workspace_id,
      channel: "discord",
      channel_instance_id: data.channel_instance_id,
      conversation_id: conversationId,
      session_id: sessionId,
      correlation_id: correlationId,
      occurred_at: new Date().toISOString(),
      actor,
      actor_type: "end_user",
      identity_refs: {
        channel_user_id: data.user_id,
      },
      payload: {
        text: data.content,
      },
      provider_extensions: {
        discord: {
          message_id: data.message_id,
          channel_id: data.channel_id,
          ...(data.guild_id !== undefined ? { guild_id: data.guild_id } : {}),
        },
      },
    };

    // -----------------------------------------------------------------------
    // Contract harness: ensure envelope + message.received specialized schema pass.
    // If this fails, return contract_violation — still no throw.
    // -----------------------------------------------------------------------
    const validationResult: ValidationResult = this.validators.validateEvent(event);
    if (!validationResult.ok) {
      return {
        ok: false,
        error: {
          code: "contract_violation",
          message: `Canonicalized event failed ${validationResult.failure.step} validation: ${validationResult.failure.issues
            .map((i) => i.message)
            .join("; ")}`,
        },
      };
    }

    return {
      ok: true,
      event,
      idempotencyKey: deriveIdempotencyKey(data),
    };
  }
}
