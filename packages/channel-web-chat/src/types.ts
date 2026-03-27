import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";

export type InboundWebChatRequest = {
  client_message_id: string;
  text: string;
  user_id: string;
  display_name?: string;
  tenant_id: string;
  workspace_id: string;
  channel_instance_id: string;
  conversation_id?: string;
  session_id?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
};

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
