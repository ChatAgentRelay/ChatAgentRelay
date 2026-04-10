import type { WebhookVerifier } from "@chat-agent-relay/contract-harness";

export class TelegramWebhookVerifier implements WebhookVerifier {
  constructor(private readonly secretToken: string) {}

  async verify(request: Request): Promise<boolean> {
    const header =
      request.headers.get("x-telegram-bot-api-secret-token") ?? request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!header) return false;
    return header === this.secretToken;
  }
}
