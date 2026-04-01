import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookVerifier } from "@chat-agent-relay/contract-harness";

export class DingTalkWebhookVerifier implements WebhookVerifier {
  constructor(private readonly secret: string) {}

  async verify(request: Request): Promise<boolean> {
    const url = new URL(request.url);
    const timestamp = url.searchParams.get("timestamp");
    const sign = url.searchParams.get("sign");
    if (!timestamp || !sign) return false;

    const expected = createHmac("sha256", this.secret)
      .update(`${timestamp}\n${this.secret}`)
      .digest("base64");

    const actualBuffer = Buffer.from(sign);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(actualBuffer, expectedBuffer);
  }
}
