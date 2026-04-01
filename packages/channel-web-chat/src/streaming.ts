import type { WebChatStreamEvent } from "./types";

export type WebChatStreamingOptions = {
  enabled: boolean;
  updateIntervalMs: number;
  postInitial: (placeholder: string) => Promise<{ providerMessageId: string }>;
  updateMessage: (text: string) => Promise<void>;
};

export function buildWebChatStreaming(
  onEvent: (event: WebChatStreamEvent) => void,
  intervalMs: number,
): WebChatStreamingOptions {
  let lastLen = 0;
  return {
    enabled: true,
    updateIntervalMs: Math.min(intervalMs, 100),
    postInitial: async () => {
      onEvent({ type: "status", status: "working" });
      return { providerMessageId: "sse" };
    },
    updateMessage: async (accumulated: string) => {
      const delta = accumulated.slice(lastLen);
      if (delta) {
        onEvent({ type: "text_delta", content: delta });
        lastLen = accumulated.length;
      }
    },
  };
}
