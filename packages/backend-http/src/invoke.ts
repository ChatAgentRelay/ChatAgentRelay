import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentInvocationContext,
  AgentResult,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { buildBackendRequest } from "./build-request";
import { extractField } from "./extract-field";
import { mapCompletedResponse } from "./map-response";
import type {
  BackendConfig,
  BackendCompletedResponse,
  BackendResponse,
  InvocationContext,
  InvocationResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GenericHttpBackend {
  private readonly config: BackendConfig;
  private readonly validators: ContractHarnessValidators;
  invokeStreaming?: (context: InvocationContext) => AsyncGenerator<string, InvocationResult>;

  private constructor(config: BackendConfig, validators: ContractHarnessValidators) {
    this.config = config;
    this.validators = validators;
  }

  static async create(config: BackendConfig): Promise<GenericHttpBackend> {
    const validators = await ContractHarnessValidators.create();
    const instance = new GenericHttpBackend(config, validators);
    if (config.streaming?.enabled) {
      instance.invokeStreaming = instance._invokeStreamingImpl.bind(instance);
    }
    return instance;
  }

  async invoke(context: InvocationContext): Promise<InvocationResult> {
    const useCustomBody = this.config.buildRequestBody !== undefined;
    const useCustomResponse = this.config.responseTextField !== undefined;

    const carRequest = buildBackendRequest(context);
    const requestId = carRequest.request_id;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const requestBody = useCustomBody
      ? this.config.buildRequestBody!(context.messageText, context.conversationHistory)
      : carRequest;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    let rawResponse: Response;
    try {
      rawResponse = await fetch(this.config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      return {
        ok: false,
        requestId,
        error: {
          code: isTimeout ? "backend_timeout" : "backend_unavailable",
          message: isTimeout
            ? `Backend did not respond within ${timeoutMs}ms`
            : `Failed to reach backend: ${error instanceof Error ? error.message : "unknown error"}`,
          retryable: true,
          category: isTimeout ? "timeout" : "backend_unavailable",
        },
      };
    }

    if (!rawResponse.ok) {
      return {
        ok: false,
        requestId,
        error: {
          code: "backend_http_error",
          message: `Backend returned HTTP ${rawResponse.status}`,
          retryable: rawResponse.status >= 500,
          category: rawResponse.status >= 500 ? "dependency_failure" : "invalid_request",
        },
      };
    }

    let body: unknown;
    try {
      body = await rawResponse.json();
    } catch {
      return {
        ok: false,
        requestId,
        error: {
          code: "invalid_response",
          message: "Backend returned unparseable JSON",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    if (useCustomResponse) {
      const text = extractField(body, this.config.responseTextField!);
      if (!text) {
        return {
          ok: false,
          requestId,
          error: {
            code: "empty_response",
            message: `Could not extract text at path "${this.config.responseTextField}" from backend response`,
            retryable: false,
            category: "dependency_failure",
          },
        };
      }

      const syntheticResponse: BackendCompletedResponse = {
        request_id: requestId,
        status: "completed",
        output: { text },
      };
      const event = mapCompletedResponse(context.invocationEvent, syntheticResponse);
      const validation = this.validators.validateEvent(event);
      if (!validation.ok) {
        return {
          ok: false,
          requestId,
          error: {
            code: "contract_violation",
            message: `Mapped response failed ${validation.failure.step} validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
            retryable: false,
            category: "invalid_request",
          },
        };
      }
      return { ok: true, event, requestId };
    }

    const typedBody = body as BackendResponse;

    if (typedBody.status === "failed") {
      return {
        ok: false,
        requestId,
        error: typedBody.error,
      };
    }

    const event = mapCompletedResponse(context.invocationEvent, typedBody);
    const validation = this.validators.validateEvent(event);

    if (!validation.ok) {
      return {
        ok: false,
        requestId,
        error: {
          code: "contract_violation",
          message: `Mapped response failed ${validation.failure.step} validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
          retryable: false,
          category: "invalid_request",
        },
      };
    }

    return { ok: true, event, requestId };
  }

  private async *_invokeStreamingImpl(context: InvocationContext): AsyncGenerator<string, InvocationResult> {
    const streamEndpoint = this.config.streaming?.endpoint ?? this.config.endpoint;
    const deltaTextField = this.config.streaming?.deltaTextField ?? "content";
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const carRequest = buildBackendRequest(context);
    const requestId = carRequest.request_id;

    const requestBody = this.config.buildRequestBody
      ? this.config.buildRequestBody(context.messageText, context.conversationHistory)
      : carRequest;

    let response: Response;
    try {
      response = await fetch(streamEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...this.config.headers,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      return {
        ok: false,
        requestId,
        error: {
          code: isTimeout ? "backend_timeout" : "backend_unavailable",
          message: isTimeout
            ? `Backend did not respond within ${timeoutMs}ms`
            : `Failed to reach backend: ${error instanceof Error ? error.message : "unknown error"}`,
          retryable: true,
          category: isTimeout ? "timeout" : "backend_unavailable",
        },
      };
    }

    if (!response.ok || !response.body) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {}
      return {
        ok: false,
        requestId,
        error: {
          code: "backend_http_error",
          message: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
          retryable: response.status >= 500,
          category: response.status >= 500 ? "dependency_failure" : "invalid_request",
        },
      };
    }

    let fullText = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const delta = extractField(parsed, deltaTextField);
          if (typeof delta === "string" && delta) {
            fullText += delta;
            yield delta;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!fullText) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "Streaming returned no content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const syntheticResponse: BackendCompletedResponse = {
      request_id: requestId,
      status: "completed",
      output: { text: fullText },
    };
    const event = mapCompletedResponse(context.invocationEvent, syntheticResponse);
    const validation = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        requestId,
        error: {
          code: "contract_violation",
          message: `Mapped response failed ${validation.failure.step} validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
          retryable: false,
          category: "invalid_request",
        },
      };
    }

    return { ok: true, event, requestId };
  }

  asAgentAdapter(): AgentAdapter {
    const self = this;
    const streamingEnabled = !!this.config.streaming?.enabled;

    const adapter: AgentAdapter = {
      describeCapabilities(): AgentCapabilities {
        return { streaming: streamingEnabled, hitl: false, cancel: false, artifacts: false };
      },

      async invoke(ctx: AgentInvocationContext): Promise<AgentResult> {
        const oldCtx: InvocationContext = {
          invocationEvent: ctx.invocationEvent,
          messageText: ctx.messageText,
          route: ctx.route,
          policy: ctx.policy,
          backendSessionHandle: ctx.sessionHandle,
          conversationHistory: ctx.conversationHistory,
        };
        const result = await self.invoke(oldCtx);
        if (!result.ok) return result;
        return { ...result, sessionHandle: undefined };
      },
    };

    if (streamingEnabled && self.invokeStreaming) {
      adapter.stream = async function* (ctx: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult> {
        const oldCtx: InvocationContext = {
          invocationEvent: ctx.invocationEvent,
          messageText: ctx.messageText,
          route: ctx.route,
          policy: ctx.policy,
          backendSessionHandle: ctx.sessionHandle,
          conversationHistory: ctx.conversationHistory,
        };
        const gen = self.invokeStreaming!(oldCtx);
        let next = await gen.next();
        while (!next.done) {
          yield { type: "text_delta", content: next.value };
          next = await gen.next();
        }
        const result = next.value;
        if (!result.ok) return result;
        return { ...result, sessionHandle: undefined };
      };
    }

    return adapter;
  }
}
