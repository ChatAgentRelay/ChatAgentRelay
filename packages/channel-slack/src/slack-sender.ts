import { chunkText } from "./chunk-text";
import type { RichMessage } from "./rich-message";
import { richMessageToSlackBlocks } from "./rich-message";
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
    const chunks = chunkText(text);
    let lastResult: { providerMessageId: string } = { providerMessageId: "unknown" };

    for (const chunk of chunks) {
      lastResult = await this.postMessage(channelId, chunk, threadTs);
    }

    return lastResult;
  }

  private async postMessage(
    channelId: string,
    text: string,
    threadTs?: string,
  ): Promise<{ providerMessageId: string }> {
    const payload: Record<string, string> = { channel: channelId, text };
    if (threadTs !== undefined) {
      payload["thread_ts"] = threadTs;
    }

    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as SlackPostMessageResponse;
    if (!body.ok) {
      throw new Error(`Slack chat.postMessage failed: ${body.error ?? "unknown error"}`);
    }

    return { providerMessageId: body.ts ?? "unknown" };
  }

  async update(channelId: string, messageTs: string, text: string): Promise<void> {
    const payload = { channel: channelId, ts: messageTs, text };
    const response = await fetch(`${SLACK_API_BASE}/chat.update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as SlackPostMessageResponse;
    if (!body.ok) {
      throw new Error(`Slack chat.update failed: ${body.error ?? "unknown error"}`);
    }
  }

  async addReaction(channelId: string, timestamp: string, emoji: string): Promise<void> {
    const payload = { channel: channelId, timestamp, name: emoji };
    const response = await fetch(`${SLACK_API_BASE}/reactions.add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as SlackPostMessageResponse;
    if (!body.ok) {
      throw new Error(`Slack reactions.add failed: ${body.error ?? "unknown error"}`);
    }
  }

  async removeReaction(channelId: string, timestamp: string, emoji: string): Promise<void> {
    const payload = { channel: channelId, timestamp, name: emoji };
    const response = await fetch(`${SLACK_API_BASE}/reactions.remove`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as SlackPostMessageResponse;
    if (!body.ok) {
      throw new Error(`Slack reactions.remove failed: ${body.error ?? "unknown error"}`);
    }
  }

  async sendRichMessage(
    channelId: string,
    message: RichMessage,
    threadTs?: string,
  ): Promise<{ providerMessageId: string }> {
    const blocks = richMessageToSlackBlocks(message);
    const payload: Record<string, unknown> = {
      channel: channelId,
      blocks,
      text: message.fallbackText,
    };
    if (threadTs !== undefined) {
      payload["thread_ts"] = threadTs;
    }

    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`,
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
