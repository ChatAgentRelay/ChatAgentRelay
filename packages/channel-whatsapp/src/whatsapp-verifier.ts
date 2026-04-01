import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookVerifier } from "@chat-agent-relay/contract-harness";

export class WhatsAppWebhookVerifier implements WebhookVerifier {
  constructor(private readonly appSecret: string) {}

  async verify(request: Request): Promise<boolean> {
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) return false;
    const body = await request.text();
    const expected = `sha256=${createHmac("sha256", this.appSecret).update(body).digest("hex")}`;
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(actualBuffer, expectedBuffer);
  }
}
