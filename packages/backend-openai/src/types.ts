export type OpenAIBackendConfig = {
  apiKey: string;
  model?: string | undefined;
  systemPrompt?: string | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
};

export type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAIChatRequest = {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean | undefined;
};

export type OpenAIStreamDelta = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export type OpenAIChatChoice = {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: string | null;
};

export type OpenAIChatResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};
