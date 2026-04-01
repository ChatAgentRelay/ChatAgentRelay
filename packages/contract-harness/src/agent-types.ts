import type { CanonicalEvent } from "./types";

// ─── Agent Capability Declaration (A2A-aligned) ───────────────────────────

export type AgentCapabilities = {
  streaming: boolean;
  multiTurn: boolean;
  resume: boolean;
  hitl: boolean;
  cancel: boolean;
  artifacts: boolean;
};

// ─── Agent Task Status (A2A Task Lifecycle) ───────────────────────────────

export type AgentTaskStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "cancelled";

// ─── Content Parts (A2A Part model) ───────────────────────────────────────

export type TextPart = { kind: "text"; text: string };
export type FilePart = { kind: "file"; name: string; mimeType: string; uri?: string; bytes?: string };
export type DataPart = { kind: "data"; data: Record<string, unknown> };

export type AgentPart = TextPart | FilePart | DataPart;

// ─── Artifacts (A2A Artifact model) ───────────────────────────────────────

export type AgentArtifact = {
  artifactId: string;
  name?: string;
  parts: AgentPart[];
};

// ─── Structured Agent Events ──────────────────────────────────────────────

export type AgentStatusEvent = { type: "status"; status: AgentTaskStatus; message?: string };
export type AgentTextDeltaEvent = { type: "text_delta"; content: string };
export type AgentArtifactEvent = { type: "artifact"; artifact: AgentArtifact };
export type AgentInputRequiredEvent = {
  type: "input_required";
  prompt: string;
  metadata?: Record<string, unknown>;
};

export type AgentEvent =
  | AgentStatusEvent
  | AgentTextDeltaEvent
  | AgentArtifactEvent
  | AgentInputRequiredEvent;

// ─── Conversation Turn ───────────────────────────────────────────────────

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

// ─── Invocation Context ──────────────────────────────────────────────────

export type AgentInvocationContext = {
  invocationEvent: CanonicalEvent;
  messageText: string;
  parts?: AgentPart[];
  route?: { route_id: string; reason: string };
  policy?: { policy_id: string; decision: string };
  sessionHandle?: string;
  conversationHistory?: ConversationTurn[];
};

// ─── Resume Input (for HITL continuation) ────────────────────────────────

export type AgentResumeInput = {
  messageText: string;
  parts?: AgentPart[];
  invocationEvent: CanonicalEvent;
};

// ─── Agent Result ────────────────────────────────────────────────────────

export type AgentSuccess = {
  ok: true;
  event: CanonicalEvent;
  requestId: string;
  sessionHandle?: string;
  artifacts?: AgentArtifact[];
};

export type AgentFailure = {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    category: string;
    details?: Record<string, unknown>;
  };
};

export type AgentResult = AgentSuccess | AgentFailure;

// ─── The Agent Adapter Interface ─────────────────────────────────────────
// This is the A2A-aligned interface that all agent adapters implement.
// Channel adapters normalize chat platforms → canonical events.
// Agent adapters normalize agent runtimes → canonical events.

export interface AgentAdapter {
  describeCapabilities(): AgentCapabilities;

  invoke(context: AgentInvocationContext): Promise<AgentResult>;

  stream?(context: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult>;

  resume?(sessionHandle: string, input: AgentResumeInput): Promise<AgentResult>;

  resumeStream?(
    sessionHandle: string,
    input: AgentResumeInput,
  ): AsyncGenerator<AgentEvent, AgentResult>;

  cancel?(sessionHandle: string): Promise<void>;
}
