import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookVerifier } from "@chat-agent-relay/contract-harness";

const VERSION_PREFIX = "v0";
const MAX_AGE_SECONDS = 60 * 5;

export class SlackWebhookVerifier implements WebhookVerifier {
  constructor(private readonly signingSecret: string, private readonly now = () => Date.now()) {}

  async verify(request: Request): Promise<boolean> {
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");
    if (!timestamp || !signature) return false;
    if (!/^\d+$/.test(timestamp)) return false;

    const ageSeconds = Math.abs(Math.floor(this.now() / 1000) - Number(timestamp));
    if (ageSeconds > MAX_AGE_SECONDS) return false;

    const body = await request.text();
    const expected = this.sign(timestamp, body);
    return safeEqual(signature, expected);
  }

  sign(timestamp: string, body: string): string {
    const payload = `${VERSION_PREFIX}:${timestamp}:${body}`;
    const digest = createHmac("sha256", this.signingSecret).update(payload).digest("hex");
    return `${VERSION_PREFIX}=${digest}`;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
