export type CanonicalEvent = Record<string, unknown> & {
  event_id: string;
  schema_version: string;
  event_type: string;
  tenant_id: string;
  workspace_id: string;
  channel: string;
  conversation_id: string;
  session_id: string;
  correlation_id: string;
  occurred_at: string;
  actor_type: string;
  payload: Record<string, unknown>;
  causation_id?: string;
  channel_instance_id?: string;
  provider_extensions?: Record<string, unknown>;
};

export type ValidationStep = "envelope" | "specialized";

export type ValidationIssue = {
  instancePath: string;
  message: string;
  keyword: string;
  schemaPath: string;
};

export type ValidationFailure = {
  step: ValidationStep;
  issues: ValidationIssue[];
};

export type ValidationSuccess = {
  ok: true;
};

export type ValidationResult = ValidationSuccess | { ok: false; failure: ValidationFailure };
