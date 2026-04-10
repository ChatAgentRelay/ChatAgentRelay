import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { DingTalkSendResponse } from "./types";

export function createDingTalkSender() {
  async function sendViaWebhook(webhookUrl: string, text: string): Promise<void> {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: text } }),
    });

    if (!response.ok) {
      throw new Error(`DingTalk webhook request failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as DingTalkSendResponse;
    if (result.errcode !== 0) {
      throw new Error(`DingTalk API error ${result.errcode}: ${result.errmsg}`);
    }
  }

  async function sendFn(event: CanonicalEvent): Promise<void> {
    const extensions = event.provider_extensions as { dingtalk?: { session_webhook?: string } } | undefined;
    const sessionWebhook = extensions?.dingtalk?.session_webhook;

    if (typeof sessionWebhook !== "string" || sessionWebhook.length === 0) {
      throw new Error("Cannot send reply: no session_webhook in provider_extensions.dingtalk");
    }

    const text = (event.payload as { text?: string }).text;
    if (typeof text !== "string") {
      throw new Error("Cannot send reply: event payload missing text");
    }

    await sendViaWebhook(sessionWebhook, text);
  }

  return { sendViaWebhook, sendFn };
}
