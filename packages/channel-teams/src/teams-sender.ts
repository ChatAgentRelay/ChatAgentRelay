import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import { createTeamsTokenManager } from "./token-manager";
import type { TeamsConversationReference, TeamsSender, TeamsTokenManager } from "./types";

export function createTeamsSender(
  appId: string,
  appSecret: string,
  tenantId: string,
  options?: { tokenManager?: TeamsTokenManager },
): TeamsSender & { sendFn(event: CanonicalEvent): Promise<void> } {
  const tokenManager = options?.tokenManager ?? createTeamsTokenManager(appId, appSecret, tenantId);

  async function authorizedFetch(url: string, init: RequestInit): Promise<Response> {
    const token = await tokenManager.getToken();
    return fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  }

  async function sendMessage(reference: TeamsConversationReference, text: string): Promise<{ messageId: string }> {
    const response = await authorizedFetch(
      `${reference.serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(reference.conversationId)}/activities`,
      {
        method: "POST",
        body: JSON.stringify({ type: "message", text }),
      },
    );

    const payload = (await response.json()) as { id?: string; error?: { message?: string } };
    if (!response.ok || typeof payload.id !== "string") {
      throw new Error(payload.error?.message ?? "Teams sendMessage failed");
    }

    return { messageId: payload.id };
  }

  async function editMessage(reference: TeamsConversationReference, messageId: string, text: string): Promise<void> {
    const response = await authorizedFetch(
      `${reference.serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(reference.conversationId)}/activities/${encodeURIComponent(messageId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ type: "message", id: messageId, text }),
      },
    );

    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message?: string } };
      throw new Error(payload.error?.message ?? "Teams editMessage failed");
    }
  }

  async function sendFn(event: CanonicalEvent): Promise<void> {
    const reference = extractConversationReference(event);
    const text = extractText(event);
    await sendMessage(reference, text);
  }

  return { sendMessage, editMessage, sendFn };
}

function extractConversationReference(event: CanonicalEvent): TeamsConversationReference {
  const teams = event.provider_extensions?.["teams"] as Record<string, unknown> | undefined;
  const serviceUrl = typeof teams?.["service_url"] === "string" ? teams["service_url"] : undefined;
  const conversationId =
    typeof teams?.["conversation_id"] === "string" ? teams["conversation_id"] : event.conversation_id;
  const tenantId = typeof teams?.["tenant_id"] === "string" ? teams["tenant_id"] : undefined;
  const activityId = typeof teams?.["activity_id"] === "string" ? teams["activity_id"] : undefined;

  if (!serviceUrl || !conversationId) {
    throw new Error("Cannot derive Teams conversation reference from canonical event");
  }

  return { serviceUrl, conversationId, tenantId, activityId };
}

function extractText(event: CanonicalEvent): string {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload["text"] === "string") return payload["text"];
  if (typeof payload["reply"] === "string") return payload["reply"];
  throw new Error("Cannot extract text from event payload");
}
