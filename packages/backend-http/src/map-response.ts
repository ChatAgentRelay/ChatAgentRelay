import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { BackendCompletedResponse } from "./types";

/**
 * Maps a completed backend response into a canonical agent.response.completed event.
 * Preserves correlation chain from the originating invocation event.
 */
export function mapCompletedResponse(
  invocationEvent: CanonicalEvent,
  backendResponse: BackendCompletedResponse,
): CanonicalEvent {
  const event: CanonicalEvent = {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: "agent.response.completed",
    tenant_id: invocationEvent.tenant_id,
    workspace_id: invocationEvent.workspace_id,
    channel: invocationEvent.channel,
    channel_instance_id: invocationEvent.channel_instance_id ?? invocationEvent.channel,
    conversation_id: invocationEvent.conversation_id,
    session_id: invocationEvent.session_id,
    correlation_id: invocationEvent.correlation_id,
    causation_id: invocationEvent.event_id,
    occurred_at: new Date().toISOString(),
    actor_type: "agent",
    payload: {
      text: backendResponse.output.text,
    },
  };

  if (backendResponse.backend?.agent_id !== undefined) {
    (event as Record<string, unknown>)["actor"] = {
      id: backendResponse.backend.agent_id,
    };
  }

  if (backendResponse.trace_context !== undefined) {
    (event as Record<string, unknown>)["trace_context"] = backendResponse.trace_context;
  }

  const extensions: Record<string, unknown> = {};
  if (backendResponse.backend?.request_id !== undefined) {
    extensions["backend_request_id"] = backendResponse.backend.request_id;
  }
  if (backendResponse.backend?.session_handle !== undefined) {
    extensions["backend_session_handle"] = backendResponse.backend.session_handle;
  }
  if (Object.keys(extensions).length > 0) {
    event.provider_extensions = { generic_http_backend: extensions };
  }

  return event;
}
