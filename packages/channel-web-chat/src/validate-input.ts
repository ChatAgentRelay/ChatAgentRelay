import type { InboundWebChatRequest, IngressError } from "./types";

const MAX_TEXT_LENGTH = 32_000;

type InputValidationSuccess = { ok: true; request: InboundWebChatRequest };
type InputValidationFailure = { ok: false; error: IngressError };
export type InputValidationResult = InputValidationSuccess | InputValidationFailure;

function fail(code: string, message: string, field?: string): InputValidationFailure {
  const error: IngressError = { code, message };
  if (field !== undefined) {
    error.field = field;
  }
  return { ok: false, error };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function validateInboundInput(raw: unknown): InputValidationResult {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("invalid_payload", "Request body must be a non-null object");
  }

  const body = raw as Record<string, unknown>;

  if (!isNonEmptyString(body["client_message_id"])) {
    return fail("missing_field", "client_message_id is required and must be a non-empty string", "client_message_id");
  }

  if (!isNonEmptyString(body["text"])) {
    return fail("missing_field", "text is required and must be a non-empty string", "text");
  }

  if (typeof body["text"] === "string" && body["text"].length > MAX_TEXT_LENGTH) {
    return fail("invalid_field", `text exceeds maximum length of ${MAX_TEXT_LENGTH}`, "text");
  }

  if (!isNonEmptyString(body["user_id"])) {
    return fail("missing_field", "user_id is required and must be a non-empty string", "user_id");
  }

  if (!isNonEmptyString(body["tenant_id"])) {
    return fail("missing_field", "tenant_id is required and must be a non-empty string", "tenant_id");
  }

  if (!isNonEmptyString(body["workspace_id"])) {
    return fail("missing_field", "workspace_id is required and must be a non-empty string", "workspace_id");
  }

  if (!isNonEmptyString(body["channel_instance_id"])) {
    return fail("missing_field", "channel_instance_id is required and must be a non-empty string", "channel_instance_id");
  }

  const request: InboundWebChatRequest = {
    client_message_id: body["client_message_id"] as string,
    text: body["text"] as string,
    user_id: body["user_id"] as string,
    tenant_id: body["tenant_id"] as string,
    workspace_id: body["workspace_id"] as string,
    channel_instance_id: body["channel_instance_id"] as string,
  };

  if (isNonEmptyString(body["display_name"])) {
    request.display_name = body["display_name"] as string;
  }
  if (isNonEmptyString(body["conversation_id"])) {
    request.conversation_id = body["conversation_id"] as string;
  }
  if (isNonEmptyString(body["session_id"])) {
    request.session_id = body["session_id"] as string;
  }
  if (isNonEmptyString(body["trace_id"])) {
    request.trace_id = body["trace_id"] as string;
  }
  if (isNonEmptyString(body["span_id"])) {
    request.span_id = body["span_id"] as string;
  }
  if (isNonEmptyString(body["parent_span_id"])) {
    request.parent_span_id = body["parent_span_id"] as string;
  }

  return { ok: true, request };
}
