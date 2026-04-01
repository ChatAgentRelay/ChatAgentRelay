import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { LarkSendMessageResponse } from "./types";

const DEFAULT_LARK_API_BASE = "https://open.feishu.cn/open-apis";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type LarkSender = {
  sendMessage: (chatId: string, text: string) => Promise<{ messageId: string }>;
  editMessage: (messageId: string, text: string) => Promise<void>;
  sendFn: (event: CanonicalEvent) => Promise<void>;
};

export function createLarkSender(appId: string, appSecret: string, options?: { apiBase?: string }): LarkSender {
  const apiBase = (options?.apiBase ?? DEFAULT_LARK_API_BASE).replace(/\/$/, "");
  let cachedToken: string | undefined;
  let tokenExpiresAt = 0;

  async function getAccessToken(): Promise<string> {
    if (cachedToken !== undefined && Date.now() < tokenExpiresAt) {
      return cachedToken;
    }

    const response = await fetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });

    const body = (await response.json()) as {
      code: number;
      msg: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (body.code !== 0 || typeof body.tenant_access_token !== "string") {
      throw new Error(`Lark token request failed: ${body.msg}`);
    }

    cachedToken = body.tenant_access_token;
    tokenExpiresAt = Date.now() + (body.expire ?? 7200) * 1000 - TOKEN_REFRESH_MARGIN_MS;
    return cachedToken;
  }

  async function sendMessage(chatId: string, text: string): Promise<{ messageId: string }> {
    const token = await getAccessToken();
    const response = await fetch(
      `${apiBase}/im/v1/messages?receive_id_type=chat_id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        }),
      },
    );

    const body = (await response.json()) as LarkSendMessageResponse;
    if (body.code !== 0) {
      throw new Error(`Lark sendMessage failed: ${body.msg}`);
    }

    return { messageId: body.data?.message_id ?? "unknown" };
  }

  async function editMessage(messageId: string, text: string): Promise<void> {
    const token = await getAccessToken();
    const response = await fetch(
      `${apiBase}/im/v1/messages/${messageId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          msg_type: "text",
          content: JSON.stringify({ text }),
        }),
      },
    );

    const body = (await response.json()) as LarkSendMessageResponse;
    if (body.code !== 0) {
      throw new Error(`Lark editMessage failed: ${body.msg}`);
    }
  }

  async function sendFn(event: CanonicalEvent): Promise<void> {
    const ext = event.provider_extensions as Record<string, Record<string, unknown>> | undefined;
    const chatId = ext?.["lark"]?.["chat_id"];
    if (typeof chatId !== "string") {
      throw new Error("Cannot derive chat_id from canonical event provider_extensions");
    }

    const text = event.payload["text"];
    if (typeof text !== "string") {
      throw new Error("Canonical event payload.text is not a string");
    }

    await sendMessage(chatId, text);
  }

  return { sendMessage, editMessage, sendFn };
}
