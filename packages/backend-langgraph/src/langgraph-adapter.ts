import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentInvocationContext,
  AgentResumeInput,
  AgentResult,
  CanonicalEvent,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type { LangGraphConfig, LangGraphInterrupt, LangGraphMessage, LangGraphRunResult, LangGraphThread } from "./types";

const DEFAULT_ASSISTANT_ID = "agent";
const DEFAULT_TIMEOUT_MS = 30_000;

export class LangGraphAdapter implements AgentAdapter {
  private readonly endpoint: string;
  private readonly assistantId: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly extraHeaders: Record<string, string>;
  private readonly validators: ContractHarnessValidators;
  private readonly threadMap = new Map<string, string>();
  private readonly runMap = new Map<string, string>();

  private constructor(config: LangGraphConfig, validators: ContractHarnessValidators) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.assistantId = config.assistantId ?? DEFAULT_ASSISTANT_ID;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.extraHeaders = config.headers ?? {};
    this.validators = validators;
  }

  static async create(config: LangGraphConfig): Promise<LangGraphAdapter> {
    const validators = await ContractHarnessValidators.create();
    return new LangGraphAdapter(config, validators);
  }

  describeCapabilities(): AgentCapabilities {
    return { streaming: true, hitl: true, cancel: true, artifacts: false };
  }

  async invoke(context: AgentInvocationContext): Promise<AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;

    let threadId: string;
    try {
      threadId = await this.getOrCreateThread(context.invocationEvent.conversation_id);
    } catch (err) {
      return this.networkError(requestId, err);
    }

    let rawResponse: Response;
    try {
      rawResponse = await fetch(`${this.endpoint}/threads/${threadId}/runs/wait`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          assistant_id: this.assistantId,
          input: { messages: [{ role: "user", content: context.messageText }] },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return this.networkError(requestId, err);
    }

    if (!rawResponse.ok) {
      return this.httpError(requestId, rawResponse);
    }

    let body: LangGraphRunResult;
    try {
      body = (await rawResponse.json()) as LangGraphRunResult;
    } catch {
      return {
        ok: false,
        requestId,
        error: {
          code: "invalid_response",
          message: "LangGraph returned unparseable JSON",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    if (body.__interrupt__?.length) {
      const text = this.extractResponseText(body);
      const event = this.mapToCanonicalEvent(context, text, requestId, threadId, body.__interrupt__);
      return {
        ok: true,
        event,
        requestId,
        sessionHandle: threadId,
      };
    }

    const text = this.extractResponseText(body);
    if (!text) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "LangGraph returned no AI message content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const event = this.mapToCanonicalEvent(context, text, requestId, threadId);
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

  async *stream(context: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;

    let threadId: string;
    try {
      threadId = await this.getOrCreateThread(context.invocationEvent.conversation_id);
    } catch (err) {
      return this.networkError(requestId, err);
    }

    let rawResponse: Response;
    try {
      rawResponse = await fetch(`${this.endpoint}/threads/${threadId}/runs/stream`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          assistant_id: this.assistantId,
          input: { messages: [{ role: "user", content: context.messageText }] },
          stream_mode: ["messages-tuple"],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return this.networkError(requestId, err);
    }

    if (!rawResponse.ok || !rawResponse.body) {
      return this.httpError(requestId, rawResponse);
    }

    let fullText = "";
    const result = yield* this.consumeSSEStream(
      rawResponse.body,
      requestId,
      threadId,
      (delta) => { fullText += delta; },
    );
    if (result) return result;

    const interrupted = await this.checkThreadInterrupt(threadId);
    if (interrupted) {
      yield { type: "input_required", prompt: this.extractInterruptPrompt(interrupted) };
      const event = this.mapToCanonicalEvent(context, fullText, requestId, threadId, interrupted);
      return { ok: true, event, requestId, sessionHandle: threadId };
    }

    if (!fullText) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "LangGraph streaming returned no content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const event = this.mapToCanonicalEvent(context, fullText, requestId, threadId);
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

  async resume(sessionHandle: string, input: AgentResumeInput): Promise<AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;
    const threadId = sessionHandle;

    let rawResponse: Response;
    try {
      rawResponse = await fetch(`${this.endpoint}/threads/${threadId}/runs/wait`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          assistant_id: this.assistantId,
          command: { resume: input.messageText },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return this.networkError(requestId, err);
    }

    if (!rawResponse.ok) {
      return this.httpError(requestId, rawResponse);
    }

    let body: LangGraphRunResult;
    try {
      body = (await rawResponse.json()) as LangGraphRunResult;
    } catch {
      return {
        ok: false,
        requestId,
        error: {
          code: "invalid_response",
          message: "LangGraph returned unparseable JSON",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    if (body.__interrupt__?.length) {
      const text = this.extractResponseText(body);
      const event = this.mapToCanonicalEvent(input, text, requestId, threadId, body.__interrupt__);
      return { ok: true, event, requestId, sessionHandle: threadId };
    }

    const text = this.extractResponseText(body);
    if (!text) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "LangGraph returned no AI message content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const event = this.mapToCanonicalEvent(input, text, requestId, threadId);
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

  async *resumeStream(sessionHandle: string, input: AgentResumeInput): AsyncGenerator<AgentEvent, AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;
    const threadId = sessionHandle;

    let rawResponse: Response;
    try {
      rawResponse = await fetch(`${this.endpoint}/threads/${threadId}/runs/stream`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          assistant_id: this.assistantId,
          command: { resume: input.messageText },
          stream_mode: ["messages-tuple"],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return this.networkError(requestId, err);
    }

    if (!rawResponse.ok || !rawResponse.body) {
      return this.httpError(requestId, rawResponse);
    }

    let fullText = "";
    const result = yield* this.consumeSSEStream(
      rawResponse.body,
      requestId,
      threadId,
      (delta) => { fullText += delta; },
    );
    if (result) return result;

    const interrupted = await this.checkThreadInterrupt(threadId);
    if (interrupted) {
      yield { type: "input_required", prompt: this.extractInterruptPrompt(interrupted) };
      const event = this.mapToCanonicalEvent(input, fullText, requestId, threadId, interrupted);
      return { ok: true, event, requestId, sessionHandle: threadId };
    }

    if (!fullText) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "LangGraph streaming returned no content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const event = this.mapToCanonicalEvent(input, fullText, requestId, threadId);
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

  async cancel(sessionHandle: string): Promise<void> {
    const runId = this.runMap.get(sessionHandle);
    if (!runId) return;

    try {
      await fetch(`${this.endpoint}/threads/${sessionHandle}/runs/${runId}`, {
        method: "DELETE",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // best-effort cancellation
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async getOrCreateThread(conversationId: string): Promise<string> {
    const existing = this.threadMap.get(conversationId);
    if (existing) return existing;

    const response = await fetch(`${this.endpoint}/threads`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Failed to create LangGraph thread: HTTP ${response.status}`);
    }

    const thread = (await response.json()) as LangGraphThread;
    this.threadMap.set(conversationId, thread.thread_id);
    return thread.thread_id;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) {
      headers["X-Api-Key"] = this.apiKey;
    }
    return headers;
  }

  private extractResponseText(result: LangGraphRunResult): string {
    if (!result.messages?.length) return "";

    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i]!;
      if (msg.type === "ai" || msg.type === "AIMessage") {
        if (typeof msg.content === "string") return msg.content;
        if (Array.isArray(msg.content)) {
          return msg.content
            .filter((p) => p.type === "text" && p.text)
            .map((p) => p.text!)
            .join("");
        }
      }
    }
    return "";
  }

  private extractInterruptPrompt(interrupts: LangGraphInterrupt[]): string {
    const first = interrupts[0];
    if (!first) return "Input required";
    if (typeof first.value === "string") return first.value;
    if (typeof first.value === "object" && first.value !== null) {
      const val = first.value as Record<string, unknown>;
      if (typeof val["question"] === "string") return val["question"];
      if (typeof val["prompt"] === "string") return val["prompt"];
      if (typeof val["message"] === "string") return val["message"];
    }
    return "Input required";
  }

  private mapToCanonicalEvent(
    context: { invocationEvent: CanonicalEvent },
    text: string,
    requestId: string,
    threadId: string,
    interrupts?: LangGraphInterrupt[],
  ): CanonicalEvent {
    const inv = context.invocationEvent;
    return {
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
      actor: { id: "langgraph" },
      payload: { text: text || "" },
      provider_extensions: {
        langgraph: {
          request_id: requestId,
          thread_id: threadId,
          assistant_id: this.assistantId,
          ...(interrupts?.length ? { interrupted: true, interrupts } : {}),
        },
      },
    };
  }

  private async *consumeSSEStream(
    body: ReadableStream<Uint8Array>,
    requestId: string,
    threadId: string,
    onDelta: (delta: string) => void,
  ): AsyncGenerator<AgentEvent, AgentResult | undefined> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let yieldedStatus = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7);
            continue;
          }

          if (!trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6);

          if (currentEvent === "metadata") {
            try {
              const meta = JSON.parse(dataStr) as { run_id?: string };
              if (meta.run_id) this.runMap.set(threadId, meta.run_id);
            } catch { /* ignore */ }
            if (!yieldedStatus) {
              yield { type: "status", status: "working" };
              yieldedStatus = true;
            }
          } else if (currentEvent === "messages") {
            try {
              const tuple = JSON.parse(dataStr) as [{ type?: string; content?: string | Array<{ type: string; text?: string }> }, ...unknown[]];
              const chunk = tuple[0];
              if (chunk?.type === "AIMessageChunk" && chunk.content) {
                let delta = "";
                if (typeof chunk.content === "string") {
                  delta = chunk.content;
                } else if (Array.isArray(chunk.content)) {
                  delta = chunk.content
                    .filter((p) => p.type === "text" && p.text)
                    .map((p) => p.text!)
                    .join("");
                }
                if (delta) {
                  onDelta(delta);
                  yield { type: "text_delta", content: delta };
                }
              }
            } catch { /* ignore malformed chunk */ }
          }

          currentEvent = "";
        }
      }
    } finally {
      reader.releaseLock();
    }

    return undefined;
  }

  private async checkThreadInterrupt(threadId: string): Promise<LangGraphInterrupt[] | null> {
    try {
      const response = await fetch(`${this.endpoint}/threads/${threadId}`, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const thread = (await response.json()) as { values?: LangGraphRunResult };
      return thread.values?.__interrupt__?.length ? thread.values.__interrupt__ : null;
    } catch {
      return null;
    }
  }

  private networkError(requestId: string, err: unknown): AgentResult {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    return {
      ok: false,
      requestId,
      error: {
        code: isTimeout ? "backend_timeout" : "backend_unavailable",
        message: isTimeout
          ? `LangGraph did not respond within ${this.timeoutMs}ms`
          : `Failed to reach LangGraph: ${err instanceof Error ? err.message : "unknown error"}`,
        retryable: true,
        category: isTimeout ? "timeout" : "backend_unavailable",
      },
    };
  }

  private async httpError(requestId: string, response: Response): Promise<AgentResult> {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch { /* ignore */ }
    return {
      ok: false,
      requestId,
      error: {
        code: "langgraph_http_error",
        message: `LangGraph returned HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
        retryable: response.status >= 500 || response.status === 429,
        category: response.status >= 500 ? "dependency_failure" : "invalid_request",
      },
    };
  }
}
