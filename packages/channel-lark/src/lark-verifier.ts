import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookVerifier } from "@chat-agent-relay/contract-harness";

export class LarkWebhookVerifier implements WebhookVerifier {
  constructor(private readonly encryptKey: string) {}

  async verify(request: Request): Promise<boolean> {
    const timestamp = request.headers.get("x-lark-request-timestamp");
    const nonce = request.headers.get("x-lark-request-nonce");
    const signature = request.headers.get("x-lark-signature");
    if (!timestamp || !nonce || !signature) return false;

    const body = await request.text();
    const expected = createHmac("sha256", this.encryptKey)
      .update(`${timestamp}${nonce}${body}`)
      .digest("base64");

    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(actualBuffer, expectedBuffer);
  }
}
