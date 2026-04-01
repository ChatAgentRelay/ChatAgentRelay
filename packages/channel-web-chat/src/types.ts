export type {
  CanonicalizationFailure,
  CanonicalizationResult,
  CanonicalizationSuccess,
  IngressError,
} from "@chat-agent-relay/contract-harness";

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
  session_handle?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
};

// ── SSE Stream Events ──────────────────────────────────────────────────

export type WebChatStreamEvent =
  | { type: "text_delta"; content: string }
  | { type: "status"; status: string; message?: string }
  | { type: "input_required"; prompt: string; session_handle: string }
  | { type: "error"; message: string }
  | {
      type: "done";
      conversation_id: string;
      correlation_id: string;
      reply: string;
      session_handle?: string;
      hitl_pending?: boolean;
    };

// ── Pipeline Function Signatures ───────────────────────────────────────

export type WebChatPipelineResult = {
  reply: string;
  conversationId: string;
  correlationId: string;
  sessionHandle?: string;
  hitlPending?: boolean;
  hitlPrompt?: string;
};

export type WebChatStreamingPipelineFn = (
  raw: unknown,
  onEvent: (event: WebChatStreamEvent) => void,
) => Promise<WebChatPipelineResult>;

export type WebChatResumeFn = (
  sessionHandle: string,
  text: string,
) => Promise<WebChatPipelineResult>;

export type WebChatResumeStreamingFn = (
  sessionHandle: string,
  text: string,
  onEvent: (event: WebChatStreamEvent) => void,
) => Promise<WebChatPipelineResult>;
