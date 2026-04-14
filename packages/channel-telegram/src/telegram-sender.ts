import type { ButtonAction, CanonicalEvent, RichMessage } from "@chat-agent-relay/contract-harness";
import { buttonsToInlineKeyboard } from "./button-keyboard";
import { richMessageToMarkdownV2 } from "./rich-message";
import type { TelegramSendMessageResponse } from "./types";

const DEFAULT_TELEGRAM_API_BASE = "https://api.telegram.org";

export type TelegramSender = {
  sendMessage(chatId: number | string, text: string): Promise<{ messageId: number }>;
  sendRichMessage(chatId: number | string, message: RichMessage): Promise<{ messageId: number }>;
  sendButtons(chatId: number | string, text: string, buttons: ButtonAction[]): Promise<{ messageId: number }>;
  editMessage(chatId: number | string, messageId: number, text: string): Promise<void>;
  sendTyping(chatId: number | string): Promise<void>;
  sendFn(event: CanonicalEvent): Promise<void>;
};

export function createTelegramSender(botToken: string, options?: { apiBase?: string }): TelegramSender {
  const root = (options?.apiBase ?? DEFAULT_TELEGRAM_API_BASE).replace(/\/$/, "");
  const apiBase = `${root}/bot${botToken}`;

  async function sendMessage(chatId: number | string, text: string): Promise<{ messageId: number }> {
    const response = await fetch(`${apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    const body = (await response.json()) as TelegramSendMessageResponse;
    if (!body.ok || !body.result) {
      throw new Error(`Telegram sendMessage failed: ${JSON.stringify(body)}`);
    }

    return { messageId: body.result.message_id };
  }

  async function sendButtons(
    chatId: number | string,
    text: string,
    buttons: ButtonAction[],
  ): Promise<{ messageId: number }> {
    const reply_markup = buttonsToInlineKeyboard(buttons);
    const response = await fetch(`${apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup }),
    });

    const body = (await response.json()) as TelegramSendMessageResponse;
    if (!body.ok || !body.result) {
      throw new Error(`Telegram sendMessage (buttons) failed: ${JSON.stringify(body)}`);
    }

    return { messageId: body.result.message_id };
  }

  async function sendRichMessage(chatId: number | string, message: RichMessage): Promise<{ messageId: number }> {
    const text = richMessageToMarkdownV2(message);
    const response = await fetch(`${apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2" }),
    });

    const body = (await response.json()) as TelegramSendMessageResponse;
    if (!body.ok || !body.result) {
      throw new Error(`Telegram sendMessage (rich) failed: ${JSON.stringify(body)}`);
    }

    return { messageId: body.result.message_id };
  }

  async function editMessage(chatId: number | string, messageId: number, text: string): Promise<void> {
    const response = await fetch(`${apiBase}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text }),
    });

    const body = (await response.json()) as TelegramSendMessageResponse;
    if (!body.ok) {
      throw new Error(`Telegram editMessageText failed: ${JSON.stringify(body)}`);
    }
  }

  async function sendTyping(chatId: number | string): Promise<void> {
    const response = await fetch(`${apiBase}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });

    const body = (await response.json()) as TelegramSendMessageResponse;
    if (!body.ok) {
      throw new Error(`Telegram sendChatAction failed: ${JSON.stringify(body)}`);
    }
  }

  async function sendFn(event: CanonicalEvent): Promise<void> {
    const chatId = extractChatId(event);
    const text = extractText(event);
    await sendMessage(chatId, text);
  }

  return { sendMessage, sendRichMessage, sendButtons, editMessage, sendTyping, sendFn };
}

function extractChatId(event: CanonicalEvent): number | string {
  const extensions = event.provider_extensions as Record<string, unknown> | undefined;
  if (extensions) {
    const telegram = extensions["telegram"] as Record<string, unknown> | undefined;
    if (telegram && telegram["chat_id"] !== undefined) {
      return telegram["chat_id"] as number;
    }
  }

  const instanceId = event.channel_instance_id;
  if (typeof instanceId === "string" && instanceId.startsWith("telegram-")) {
    return instanceId.slice("telegram-".length);
  }

  throw new Error("Cannot extract chat_id from event: no provider_extensions.telegram.chat_id or channel_instance_id");
}

function extractText(event: CanonicalEvent): string {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload["text"] === "string") return payload["text"];
  if (typeof payload["reply"] === "string") return payload["reply"];
  throw new Error("Cannot extract text from event payload");
}
