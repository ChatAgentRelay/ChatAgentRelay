export type A2AAgentConfig = {
  endpoint: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type A2AAgentCard = {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
  };
};

export type A2APart =
  | { kind: "text"; text: string }
  | { kind: "file"; file: { uri?: string; bytes?: string; mimeType?: string; name?: string } }
  | { kind: "data"; data: Record<string, unknown> };

export type A2AMessage = {
  kind: "message";
  messageId: string;
  role: "user" | "agent";
  parts: A2APart[];
};

export type A2AArtifact = {
  artifactId: string;
  name?: string;
  parts: A2APart[];
};

export type A2ATaskStatus = {
  state: string;
  message?: A2AMessage;
  timestamp: string;
};

export type A2ATask = {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
};

export type A2AStreamEvent =
  | {
      kind: "status-update";
      taskId: string;
      contextId: string;
      status: A2ATaskStatus;
      final: boolean;
    }
  | {
      kind: "artifact-update";
      taskId: string;
      contextId: string;
      artifact: A2AArtifact;
    }
  | (A2AMessage & { taskId?: string; contextId?: string })
  | (A2ATask & { kind: "task" });
