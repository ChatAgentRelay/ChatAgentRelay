import type { SlackPostMessageResponse } from "./types";

const SLACK_API_BASE = "https://slack.com/api";

export type SlackSenderConfig = {
  botToken: string;
};

export class SlackSender {
  private readonly botToken: string;

  constructor(config: SlackSenderConfig) {
    this.botToken = config.botToken;
  }

  async send(channelId: string, text: string, threadTs?: string): Promise<{ providerMessageId: string }> {
    const payload: Record<string, string> = { channel: channelId, text };
    if (threadTs !== undefined) {
      payload["thread_ts"] = threadTs;
    }

    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as SlackPostMessageResponse;
    if (!body.ok) {
      throw new Error(`Slack chat.postMessage failed: ${body.error ?? "unknown error"}`);
    }

    return { providerMessageId: body.ts ?? "unknown" };
  }

  createSendFn(channelId: string, threadTs?: string): (text: string) => Promise<{ providerMessageId: string }> {
    return (text: string) => this.send(channelId, text, threadTs);
  }
}
