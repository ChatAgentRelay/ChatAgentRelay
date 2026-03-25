import type { CanonicalEvent } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";
import type { InvocationContext, InvocationResult } from "@cap/backend-http";
import type { OpenAIBackendConfig, OpenAIChatRequest, OpenAIChatResponse, OpenAIStreamDelta } from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenAIBackend {
  private readonly validators: ContractHarnessValidators;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  private constructor(config: OpenAIBackendConfig, validators: ContractHarnessValidators) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const raw = config.baseUrl ?? DEFAULT_BASE_URL;
    this.baseUrl = raw.replace(/\/+$/, "").endsWith("/v1") ? raw.replace(/\/+$/, "") : `${raw.replace(/\/+$/, "")}/v1`;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.validators = validators;
  }

  static async create(config: OpenAIBackendConfig): Promise<OpenAIBackend> {
    const validators = await ContractHarnessValidators.create();
    return new OpenAIBackend(config, validators);
  }

  async invoke(context: InvocationContext): Promise<InvocationResult> {
    const requestId = `req_${crypto.randomUUID()}`;

    const messages: OpenAIChatRequest["messages"] = [
      { role: "system", content: this.systemPrompt },
    ];

    if (context.conversationHistory) {
      for (const turn of context.conversationHistory) {
        messages.push({ role: turn.role, content: turn.content });
      }
    }

    messages.push({ role: "user", content: context.messageText });

    const chatRequest: OpenAIChatRequest = {
      model: this.model,
      messages,
    };

    let rawResponse: Response;
    try {
      rawResponse = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(chatRequest),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      return {
        ok: false,
        requestId,
        error: {
          code: isTimeout ? "backend_timeout" : "backend_unavailable",
          message: isTimeout
            ? `OpenAI did not respond within ${this.timeoutMs}ms`
            : `Failed to reach OpenAI: ${error instanceof Error ? error.message : "unknown error"}`,
          retryable: true,
          category: isTimeout ? "timeout" : "backend_unavailable",
        },
      };
    }

    if (!rawResponse.ok) {
      let errorBody = "";
      try {
        errorBody = await rawResponse.text();
      } catch { /* ignore */ }
      return {
        ok: false,
        requestId,
        error: {
          code: "openai_http_error",
          message: `OpenAI returned HTTP ${rawResponse.status}: ${errorBody.slice(0, 200)}`,
          retryable: rawResponse.status >= 500 || rawResponse.status === 429,
          category: rawResponse.status >= 500 ? "dependency_failure" : "invalid_request",
        },
      };
    }

    let body: OpenAIChatResponse;
    try {
      body = (await rawResponse.json()) as OpenAIChatResponse;
    } catch {
      return {
        ok: false,
        requestId,
        error: {
          code: "invalid_response",
          message: "OpenAI returned unparseable JSON",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const choice = body.choices[0];
    if (!choice || !choice.message.content) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "OpenAI returned no content in response",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const event = this.mapToCanonicalEvent(context, body, choice.message.content, requestId);
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

  async *invokeStreaming(context: InvocationContext): AsyncGenerator<string, InvocationResult> {
    const requestId = `req_${crypto.randomUUID()}`;

    const messages: OpenAIChatRequest["messages"] = [
      { role: "system", content: this.systemPrompt },
    ];
    if (context.conversationHistory) {
      for (const turn of context.conversationHistory) {
        messages.push({ role: turn.role, content: turn.content });
      }
    }
    messages.push({ role: "user", content: context.messageText });

    const chatRequest: OpenAIChatRequest = { model: this.model, messages, stream: true };

    let rawResponse: Response;
    try {
      rawResponse = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(chatRequest),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
      return {
        ok: false,
        requestId,
        error: {
          code: isTimeout ? "backend_timeout" : "backend_unavailable",
          message: isTimeout
            ? `OpenAI did not respond within ${this.timeoutMs}ms`
            : `Failed to reach OpenAI: ${error instanceof Error ? error.message : "unknown error"}`,
          retryable: true,
          category: isTimeout ? "timeout" : "backend_unavailable",
        },
      };
    }

    if (!rawResponse.ok || !rawResponse.body) {
      let errorBody = "";
      try { errorBody = await rawResponse.text(); } catch { /* ignore */ }
      return {
        ok: false,
        requestId,
        error: {
          code: "openai_http_error",
          message: `OpenAI returned HTTP ${rawResponse.status}: ${errorBody.slice(0, 200)}`,
          retryable: rawResponse.status >= 500 || rawResponse.status === 429,
          category: rawResponse.status >= 500 ? "dependency_failure" : "invalid_request",
        },
      };
    }

    let fullText = "";
    let lastModel = this.model;
    let lastId = "";
    let finishReason = "stop";
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    const reader = rawResponse.body.getReader();
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
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          let chunk: OpenAIStreamDelta;
          try {
            chunk = JSON.parse(data) as OpenAIStreamDelta;
          } catch {
            continue;
          }

          lastId = chunk.id;
          lastModel = chunk.model;
          if (chunk.usage) usage = chunk.usage;

          const choice = chunk.choices[0];
          if (choice) {
            if (choice.delta.content) {
              fullText += choice.delta.content;
              yield choice.delta.content;
            }
            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }
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
          message: "OpenAI streaming returned no content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const syntheticResponse: OpenAIChatResponse = {
      id: lastId,
      object: "chat.completion",
      created: Date.now(),
      model: lastModel,
      choices: [{ index: 0, message: { role: "assistant", content: fullText }, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    };

    const event = this.mapToCanonicalEvent(context, syntheticResponse, fullText, requestId);
    const validation = this.validators.validateEvent(event);
    if (!validation.ok) {
      return {
        ok: false,
        requestId,
        error: {
          code: "contract_violation",
          message: `Mapped response failed validation: ${validation.failure.issues.map((i) => i.message).join("; ")}`,
          retryable: false,
          category: "invalid_request",
        },
      };
    }

    return { ok: true, event, requestId };
  }

  private mapToCanonicalEvent(
    context: InvocationContext,
    openaiResponse: OpenAIChatResponse,
    text: string,
    requestId: string,
  ): CanonicalEvent {
    const inv = context.invocationEvent;
    const event: CanonicalEvent = {
      event_id: `evt_${crypto.randomUUID()}`,
      schema_version: "v1alpha1",
      event_type: "agent.response.completed",
      tenant_id: inv.tenant_id,
      workspace_id: inv.workspace_id,
      channel: inv.channel,
      channel_instance_id: inv.channel_instance_id ?? inv.channel,
      conversation_id: inv.conversation_id,
      session_id: inv.session_id,
      correlation_id: inv.correlation_id,
      causation_id: inv.event_id,
      occurred_at: new Date().toISOString(),
      actor_type: "agent",
      actor: { id: openaiResponse.model },
      payload: { text },
      provider_extensions: {
        openai: {
          request_id: requestId,
          model: openaiResponse.model,
          openai_id: openaiResponse.id,
          finish_reason: openaiResponse.choices[0]?.finish_reason ?? "unknown",
          ...(openaiResponse.usage ? {
            prompt_tokens: openaiResponse.usage.prompt_tokens,
            completion_tokens: openaiResponse.usage.completion_tokens,
            total_tokens: openaiResponse.usage.total_tokens,
          } : {}),
        },
      },
    };
    return event;
  }
}
