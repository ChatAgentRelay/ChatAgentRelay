export type ACPConfig = {
  command: string;
  args?: string[];
  workDir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  permissionPolicy?: "auto-approve" | "deny" | "hitl";
};

export type ACPProtocolVersion = string;

export type ACPClientCapabilities = {
  fs: { readTextFile: boolean; writeTextFile: boolean };
  terminal: boolean;
};

export type ACPAgentCapabilities = {
  loadSession?: boolean;
  mcpCapabilities?: { http: boolean; sse: boolean };
  promptCapabilities?: { audio: boolean; embeddedContext: boolean; image: boolean };
  sessionCapabilities?: Record<string, unknown>;
};

export type ACPImplementation = {
  name: string;
  version: string;
};

export type ACPInitializeRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: "initialize";
  params: {
    protocolVersion: ACPProtocolVersion;
    capabilities: ACPClientCapabilities;
    clientInfo?: ACPImplementation;
  };
};

export type ACPInitializeResponse = {
  protocolVersion: ACPProtocolVersion;
  capabilities: ACPAgentCapabilities;
  agentInfo?: ACPImplementation;
  authMethods?: unknown[];
};

export type ACPNewSessionRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: "session/new";
  params: {
    workDir?: string;
    mcpServers: unknown[];
  };
};

export type ACPNewSessionResponse = {
  sessionId: string;
  configOptions?: unknown;
  modeState?: unknown;
};

export type ACPContentBlock =
  | { type: "text"; text: string }
  | { type: "resource"; uri: string; mimeType?: string; text?: string }
  | { type: "resource_link"; uri: string; name?: string };

export type ACPPromptRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: "session/prompt";
  params: {
    sessionId: string;
    content: ACPContentBlock[];
  };
};

export type ACPStopReason = "end_turn" | "cancelled" | "max_tokens" | "tool_use";

export type ACPPromptResponse = {
  stopReason: ACPStopReason;
};

export type ACPCancelNotification = {
  jsonrpc: "2.0";
  method: "session/cancel";
  params: { sessionId: string };
};

export type ACPMessageChunk = {
  type: "message_chunk";
  role: "assistant" | "user" | "thought";
  content: string;
};

export type ACPToolCallStart = {
  type: "tool_call_start";
  toolCallId: string;
  toolName: string;
  params?: Record<string, unknown>;
};

export type ACPToolCallUpdate = {
  type: "tool_call_content";
  toolCallId: string;
  content: string;
};

export type ACPToolCallComplete = {
  type: "tool_call_complete";
  toolCallId: string;
  exitCode?: number;
};

export type ACPSessionUpdate =
  | ACPMessageChunk
  | ACPToolCallStart
  | ACPToolCallUpdate
  | ACPToolCallComplete
  | { type: string; [key: string]: unknown };

export type ACPSessionNotification = {
  jsonrpc: "2.0";
  method: "session/update";
  params: {
    sessionId: string;
    update: ACPSessionUpdate;
  };
};

export type ACPPermissionOption = {
  id: string;
  label: string;
  isDefault?: boolean;
};

export type ACPToolCallInfo = {
  toolCallId: string;
  toolName: string;
  params?: Record<string, unknown>;
};

export type ACPRequestPermission = {
  jsonrpc: "2.0";
  id: string | number;
  method: "session/request_permission";
  params: {
    sessionId: string;
    toolCall: ACPToolCallInfo;
    options: ACPPermissionOption[];
  };
};

export type ACPRequestPermissionOutcome = "allow" | "deny" | "cancelled";

export type ACPJsonRpcMessage = {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};
