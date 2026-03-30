export type LangGraphConfig = {
  endpoint: string;
  assistantId?: string;
  apiKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type LangGraphThread = {
  thread_id: string;
  created_at: string;
  metadata: Record<string, unknown>;
  status: string;
};

export type LangGraphMessage = {
  type: string;
  content: string | Array<{ type: string; text?: string }>;
  id?: string;
  name?: string;
};

export type LangGraphInterrupt = {
  value: unknown;
  resumable: boolean;
  ns: string[];
  when: string;
};

export type LangGraphRunResult = {
  messages?: LangGraphMessage[];
  __interrupt__?: LangGraphInterrupt[];
};

export type LangGraphStreamChunk = {
  event: string;
  data: unknown;
};
