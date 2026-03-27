import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";

export type BackendConfig = {
  endpoint: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  buildRequestBody?: (messageText: string, conversationHistory?: ConversationTurn[]) => unknown;
  responseTextField?: string;
};

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type InvocationContext = {
  invocationEvent: CanonicalEvent;
  messageText: string;
  route?: { route_id: string; reason: string } | undefined;
  policy?: { policy_id: string; decision: string } | undefined;
  backendSessionHandle?: string | undefined;
  conversationHistory?: ConversationTurn[] | undefined;
};

export type BackendInvocationRequest = {
  request_id: string;
  car: {
    event: CanonicalEvent;
    input: { message: { text: string } };
    context: {
      route: { route_id: string; reason: string };
      policy: { policy_id: string; decision: string };
    };
  };
  backend_session?: { handle: string };
};

export type BackendCompletedResponse = {
  request_id: string;
  status: "completed";
  output: { text: string };
  backend?: {
    request_id?: string;
    session_handle?: string;
    agent_id?: string;
  };
  trace_context?: {
    trace_id: string;
    span_id?: string;
    parent_span_id?: string;
  };
};

export type BackendErrorResponse = {
  request_id: string;
  status: "failed";
  error: {
    code: string;
    message: string;
    retryable: boolean;
    category: string;
    details?: Record<string, unknown>;
  };
};

export type BackendResponse = BackendCompletedResponse | BackendErrorResponse;

export type InvocationSuccess = {
  ok: true;
  event: CanonicalEvent;
  requestId: string;
};

export type InvocationFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    category: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
};

export type InvocationResult = InvocationSuccess | InvocationFailure;
