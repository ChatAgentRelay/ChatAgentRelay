import type { InboundWebChatRequest } from "./types";

/**
 * Derives a stable idempotency key from the inbound request.
 * The key is deterministic: the same logical delivery always produces
 * the same key, preventing duplicate canonical event chains.
 */
export function deriveIdempotencyKey(request: InboundWebChatRequest): string {
  const parts = [request.tenant_id, request.channel_instance_id, request.client_message_id];
  return `webchat:${parts.join(":")}`;
}
