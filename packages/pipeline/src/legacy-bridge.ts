import type { InvocationContext } from "@chat-agent-relay/backend-http";
import type {
  AgentAdapter,
  AgentEvent,
  AgentInvocationContext,
  AgentResult,
} from "@chat-agent-relay/contract-harness";
import type { BackendAdapter } from "./types";

function toInvocationContext(ctx: AgentInvocationContext): InvocationContext {
  return {
    invocationEvent: ctx.invocationEvent,
    messageText: ctx.messageText,
    route: ctx.route,
    policy: ctx.policy,
    backendSessionHandle: ctx.sessionHandle,
    conversationHistory: ctx.conversationHistory,
  };
}

function toAgentResult(result: import("@chat-agent-relay/backend-http").InvocationResult): AgentResult {
  if (!result.ok) {
    return { ok: false, requestId: result.requestId, error: result.error };
  }
  return { ok: true, event: result.event, requestId: result.requestId };
}

export function legacyBridge(backend: BackendAdapter): AgentAdapter {
  const adapter: AgentAdapter = {
    describeCapabilities() {
      return {
        streaming: !!backend.invokeStreaming,
        hitl: false,
        cancel: false,
        artifacts: false,
      };
    },

    async invoke(context: AgentInvocationContext): Promise<AgentResult> {
      const legacy = toInvocationContext(context);
      const result = await backend.invoke(legacy);
      return toAgentResult(result);
    },
  };

  if (backend.invokeStreaming) {
    const streamingBackend = backend.invokeStreaming.bind(backend);
    adapter.stream = async function* (context: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult> {
      const legacy = toInvocationContext(context);
      const generator = streamingBackend(legacy);

      while (true) {
        const { done, value } = await generator.next();
        if (done) {
          return toAgentResult(value);
        }
        yield { type: "text_delta", content: value } as AgentEvent;
      }
    };
  }

  return adapter;
}
