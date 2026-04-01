import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { WhatsAppSendMessageResponse, WhatsAppSessionTracker } from "./types";

const DEFAULT_WHATSAPP_API_BASE = "https://graph.facebook.com/v21.0";
const SESSION_WARNING_THRESHOLD_MS = 60 * 60 * 1000;

export type WhatsAppSender = {
  sendMessage(to: string, text: string): Promise<{ messageId: string }>;
  sendFn(event: CanonicalEvent): Promise<void>;
};

export function createWhatsAppSender(
  phoneNumberId: string,
  accessToken: string,
  options?: { apiBase?: string; sessionTracker?: WhatsAppSessionTracker; now?: () => Date; warn?: (message: string) => void },
): WhatsAppSender {
  const root = (options?.apiBase ?? DEFAULT_WHATSAPP_API_BASE).replace(/\/$/, "");
  const sessionTracker = options?.sessionTracker;
  const now = options?.now ?? (() => new Date());
  const warn = options?.warn ?? ((message: string) => console.warn(message));

  async function sendMessage(to: string, text: string): Promise<{ messageId: string }> {
    maybeWarnAboutSessionWindow(to);

    const response = await fetch(`${root}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });

    const body = (await response.json()) as WhatsAppSendMessageResponse;
    const messageId = body.messages?.[0]?.id;
    if (!response.ok || !messageId) {
      throw new Error(`WhatsApp sendMessage failed: ${body.error?.message ?? JSON.stringify(body)}`);
    }

    return { messageId };
  }

  function maybeWarnAboutSessionWindow(to: string): void {
    if (!sessionTracker) {
      return;
    }

    const session = sessionTracker.get(to);
    if (!session) {
      warn(`WhatsApp send to ${to} has no active inbound session; delivery may require a template message outside the 24-hour window.`);
      return;
    }

    const expiresAt = Date.parse(session.expiresAt);
    if (Number.isNaN(expiresAt)) {
      warn(`WhatsApp send to ${to} has invalid session expiry metadata (${session.expiresAt}).`);
      return;
    }

    const remainingMs = expiresAt - now().getTime();
    if (remainingMs <= 0) {
      warn(`WhatsApp send to ${to} is outside the 24-hour session window (expired at ${session.expiresAt}).`);
      return;
    }

    if (remainingMs < SESSION_WARNING_THRESHOLD_MS) {
      warn(`WhatsApp send to ${to} is nearing the end of the 24-hour session window (expires at ${session.expiresAt}).`);
    }
  }

  async function sendFn(event: CanonicalEvent): Promise<void> {
    const wa = event.provider_extensions?.["whatsapp"] as Record<string, unknown> | undefined;
    const to = wa?.["from"];
    const text = typeof event.payload["text"] === "string"
      ? event.payload["text"]
      : typeof event.payload["reply"] === "string"
        ? event.payload["reply"]
        : undefined;
    if (typeof to !== "string" || !to) throw new Error("Cannot send reply: no provider_extensions.whatsapp.from");
    if (!text) throw new Error("Cannot send reply: missing text payload");
    await sendMessage(to, text);
  }

  return { sendMessage, sendFn };
}
