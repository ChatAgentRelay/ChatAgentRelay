import type {
  AgentAdapter,
  AgentArtifact,
  AgentCapabilities,
  AgentEvent,
  AgentInvocationContext,
  AgentPart,
  AgentResumeInput,
  AgentResult,
  CanonicalEvent,
} from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import type {
  A2AAgentCard,
  A2AAgentConfig,
  A2AArtifact,
  A2AMessage,
  A2APart,
  A2AStreamEvent,
  A2ATask,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export class A2AAgentAdapter implements AgentAdapter {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly validators: ContractHarnessValidators;
  private readonly agentCard: A2AAgentCard | undefined;

  private constructor(
    config: A2AAgentConfig,
    validators: ContractHarnessValidators,
    agentCard?: A2AAgentCard,
  ) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.headers = config.headers ?? {};
    this.validators = validators;
    this.agentCard = agentCard;
  }

  static async create(config: A2AAgentConfig): Promise<A2AAgentAdapter> {
    const validators = await ContractHarnessValidators.create();
    let agentCard: A2AAgentCard | undefined;

    try {
      const url = `${config.endpoint.replace(/\/+$/, "")}/.well-known/agent.json`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(config.timeoutMs ?? 5_000),
      });
      if (resp.ok) {
        agentCard = (await resp.json()) as A2AAgentCard;
      }
    } catch {
      // Agent Card is best-effort; proceed without it
    }

    return new A2AAgentAdapter(config, validators, agentCard);
  }

  describeCapabilities(): AgentCapabilities {
    if (this.agentCard?.capabilities) {
      return {
        streaming: this.agentCard.capabilities.streaming ?? true,
        hitl: true,
        cancel: true,
        artifacts: true,
      };
    }
    return { streaming: true, hitl: true, cancel: true, artifacts: true };
  }

  async invoke(context: AgentInvocationContext): Promise<AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;
    const messageId = crypto.randomUUID();
    const contextId = context.sessionHandle ?? crypto.randomUUID();

    const body = {
      jsonrpc: "2.0",
      id: requestId,
      method: "message/send",
      params: {
        message: {
          kind: "message",
          messageId,
          role: "user",
          parts: this.buildParts(context),
          contextId,
        },
      },
    };

    let rawResponse: Response;
    try {
      rawResponse = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      return this.networkError(requestId, error);
    }

    if (!rawResponse.ok) {
      return this.httpError(requestId, rawResponse);
    }

    let json: Record<string, unknown>;
    try {
      json = (await rawResponse.json()) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        requestId,
        error: {
          code: "invalid_response",
          message: "A2A agent returned unparseable JSON",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    if (json["error"]) {
      const rpcError = json["error"] as Record<string, unknown>;
      return {
        ok: false,
        requestId,
        error: {
          code: "a2a_rpc_error",
          message: String(rpcError["message"] ?? "Unknown JSON-RPC error"),
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const task = json["result"] as A2ATask | undefined;
    if (!task) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "A2A agent returned no task in result",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    return this.taskToResult(task, context, requestId);
  }

  async *stream(context: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;
    const messageId = crypto.randomUUID();
    const contextId = context.sessionHandle ?? crypto.randomUUID();

    const body = {
      jsonrpc: "2.0",
      id: requestId,
      method: "message/stream",
      params: {
        message: {
          kind: "message",
          messageId,
          role: "user",
          parts: this.buildParts(context),
          contextId,
        },
      },
    };

    let rawResponse: Response;
    try {
      rawResponse = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      return this.networkError(requestId, error);
    }

    if (!rawResponse.ok || !rawResponse.body) {
      return this.httpError(requestId, rawResponse);
    }

    let fullText = "";
    let lastTask: A2ATask | undefined;
    const artifacts: AgentArtifact[] = [];

    for await (const raw of parseSSE(rawResponse)) {
      const event = raw as A2AStreamEvent;

      if (isStatusUpdate(event)) {
        lastTask = { id: event.taskId, contextId: event.contextId, status: event.status };

        if (event.status.state === "working") {
          yield { type: "status", status: "working" };
        } else if (event.status.state === "input-required") {
          const prompt = extractTextFromMessage(event.status.message);
          yield { type: "input_required", prompt: prompt || "Input required" };
        } else if (event.status.state === "completed") {
          const msgText = extractTextFromMessage(event.status.message);
          if (msgText) fullText += msgText;
        } else if (event.status.state === "failed") {
          return {
            ok: false,
            requestId,
            error: {
              code: "a2a_task_failed",
              message: extractTextFromMessage(event.status.message) || "Task failed",
              retryable: false,
              category: "dependency_failure",
            },
          };
        }
      } else if (isArtifactUpdate(event)) {
        const mapped = mapA2AArtifactToAgentArtifact(event.artifact);
        artifacts.push(mapped);
        yield { type: "artifact", artifact: mapped };
      } else if (isMessage(event) && event.role === "agent") {
        const text = extractTextFromParts(event.parts);
        if (text) {
          fullText += text;
          yield { type: "text_delta", content: text };
        }
      }
    }

    if (!fullText && lastTask) {
      const msgText = extractTextFromMessage(lastTask.status.message);
      if (msgText) fullText = msgText;
    }

    if (!fullText) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "A2A stream produced no text content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const sessionHandle = lastTask?.contextId ?? contextId;
    const event = this.mapToCanonicalEvent(context, fullText, requestId, sessionHandle);
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

    return {
      ok: true,
      event,
      requestId,
      sessionHandle,
      ...(artifacts.length > 0 ? { artifacts } : {}),
    };
  }

  async resume(sessionHandle: string, input: AgentResumeInput): Promise<AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;
    const messageId = crypto.randomUUID();

    const body = {
      jsonrpc: "2.0",
      id: requestId,
      method: "message/send",
      params: {
        message: {
          kind: "message",
          messageId,
          role: "user",
          parts: this.buildPartsFromResume(input),
          contextId: sessionHandle,
        },
      },
    };

    let rawResponse: Response;
    try {
      rawResponse = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      return this.networkError(requestId, error);
    }

    if (!rawResponse.ok) {
      return this.httpError(requestId, rawResponse);
    }

    let json: Record<string, unknown>;
    try {
      json = (await rawResponse.json()) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        requestId,
        error: {
          code: "invalid_response",
          message: "A2A agent returned unparseable JSON",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    if (json["error"]) {
      const rpcError = json["error"] as Record<string, unknown>;
      return {
        ok: false,
        requestId,
        error: {
          code: "a2a_rpc_error",
          message: String(rpcError["message"] ?? "Unknown JSON-RPC error"),
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const task = json["result"] as A2ATask | undefined;
    if (!task) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "A2A agent returned no task in result",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    return this.taskToResultFromResume(task, input, requestId, sessionHandle);
  }

  async *resumeStream(
    sessionHandle: string,
    input: AgentResumeInput,
  ): AsyncGenerator<AgentEvent, AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;
    const messageId = crypto.randomUUID();

    const body = {
      jsonrpc: "2.0",
      id: requestId,
      method: "message/stream",
      params: {
        message: {
          kind: "message",
          messageId,
          role: "user",
          parts: this.buildPartsFromResume(input),
          contextId: sessionHandle,
        },
      },
    };

    let rawResponse: Response;
    try {
      rawResponse = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      return this.networkError(requestId, error);
    }

    if (!rawResponse.ok || !rawResponse.body) {
      return this.httpError(requestId, rawResponse);
    }

    let fullText = "";
    let lastTask: A2ATask | undefined;
    const artifacts: AgentArtifact[] = [];

    for await (const raw of parseSSE(rawResponse)) {
      const event = raw as A2AStreamEvent;

      if (isStatusUpdate(event)) {
        lastTask = { id: event.taskId, contextId: event.contextId, status: event.status };

        if (event.status.state === "working") {
          yield { type: "status", status: "working" };
        } else if (event.status.state === "input-required") {
          const prompt = extractTextFromMessage(event.status.message);
          yield { type: "input_required", prompt: prompt || "Input required" };
        } else if (event.status.state === "completed") {
          const msgText = extractTextFromMessage(event.status.message);
          if (msgText) fullText += msgText;
        } else if (event.status.state === "failed") {
          return {
            ok: false,
            requestId,
            error: {
              code: "a2a_task_failed",
              message: extractTextFromMessage(event.status.message) || "Task failed",
              retryable: false,
              category: "dependency_failure",
            },
          };
        }
      } else if (isArtifactUpdate(event)) {
        const mapped = mapA2AArtifactToAgentArtifact(event.artifact);
        artifacts.push(mapped);
        yield { type: "artifact", artifact: mapped };
      } else if (isMessage(event) && event.role === "agent") {
        const text = extractTextFromParts(event.parts);
        if (text) {
          fullText += text;
          yield { type: "text_delta", content: text };
        }
      }
    }

    if (!fullText && lastTask) {
      const msgText = extractTextFromMessage(lastTask.status.message);
      if (msgText) fullText = msgText;
    }

    if (!fullText) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "A2A stream produced no text content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const inv = input.invocationEvent;
    const event = this.buildCanonicalEvent(inv, fullText, requestId, sessionHandle);
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

    return {
      ok: true,
      event,
      requestId,
      sessionHandle,
      ...(artifacts.length > 0 ? { artifacts } : {}),
    };
  }

  async cancel(sessionHandle: string): Promise<void> {
    const body = {
      jsonrpc: "2.0",
      id: `req_${crypto.randomUUID()}`,
      method: "task/cancel",
      params: { id: sessionHandle },
    };

    await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private buildParts(context: AgentInvocationContext): A2APart[] {
    if (context.parts && context.parts.length > 0) {
      return context.parts.map(mapAgentPartToA2APart);
    }
    return [{ kind: "text", text: context.messageText }];
  }

  private buildPartsFromResume(input: AgentResumeInput): A2APart[] {
    if (input.parts && input.parts.length > 0) {
      return input.parts.map(mapAgentPartToA2APart);
    }
    return [{ kind: "text", text: input.messageText }];
  }

  private taskToResult(
    task: A2ATask,
    context: AgentInvocationContext,
    requestId: string,
  ): AgentResult {
    const sessionHandle = task.contextId;

    if (task.status.state === "input-required") {
      const prompt = extractTextFromMessage(task.status.message);
      const event = this.mapToCanonicalEvent(
        context,
        prompt || "Input required by agent",
        requestId,
        sessionHandle,
      );
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
      return {
        ok: true,
        event: {
          ...event,
          provider_extensions: {
            ...event.provider_extensions,
            a2a: {
              ...(event.provider_extensions?.["a2a"] as Record<string, unknown> | undefined),
              input_required: true,
              task_state: "input-required",
            },
          },
        },
        requestId,
        sessionHandle,
      };
    }

    if (task.status.state === "failed") {
      return {
        ok: false,
        requestId,
        error: {
          code: "a2a_task_failed",
          message: extractTextFromMessage(task.status.message) || "Task failed",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const text = extractTextFromMessage(task.status.message);
    if (!text) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "A2A task completed with no text content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const event = this.mapToCanonicalEvent(context, text, requestId, sessionHandle);
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

    return { ok: true, event, requestId, sessionHandle };
  }

  private taskToResultFromResume(
    task: A2ATask,
    input: AgentResumeInput,
    requestId: string,
    sessionHandle: string,
  ): AgentResult {
    const inv = input.invocationEvent;

    if (task.status.state === "failed") {
      return {
        ok: false,
        requestId,
        error: {
          code: "a2a_task_failed",
          message: extractTextFromMessage(task.status.message) || "Task failed",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const text = extractTextFromMessage(task.status.message);
    if (!text) {
      return {
        ok: false,
        requestId,
        error: {
          code: "empty_response",
          message: "A2A task completed with no text content",
          retryable: false,
          category: "dependency_failure",
        },
      };
    }

    const event = this.buildCanonicalEvent(inv, text, requestId, sessionHandle);
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

    return { ok: true, event, requestId, sessionHandle };
  }

  private mapToCanonicalEvent(
    context: AgentInvocationContext,
    text: string,
    requestId: string,
    sessionHandle: string,
  ): CanonicalEvent {
    const inv = context.invocationEvent;
    return this.buildCanonicalEvent(inv, text, requestId, sessionHandle);
  }

  private buildCanonicalEvent(
    inv: CanonicalEvent,
    text: string,
    requestId: string,
    sessionHandle: string,
  ): CanonicalEvent {
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
      actor: { id: this.agentCard?.name ?? "a2a-agent" },
      payload: { text },
      provider_extensions: {
        a2a: {
          request_id: requestId,
          agent_name: this.agentCard?.name,
          context_id: sessionHandle,
        },
      },
    };
  }

  private networkError(requestId: string, error: unknown): AgentResult {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    return {
      ok: false,
      requestId,
      error: {
        code: isTimeout ? "backend_timeout" : "backend_unavailable",
        message: isTimeout
          ? `A2A agent did not respond within ${this.timeoutMs}ms`
          : `Failed to reach A2A agent: ${error instanceof Error ? error.message : "unknown error"}`,
        retryable: true,
        category: isTimeout ? "timeout" : "backend_unavailable",
      },
    };
  }

  private async httpError(requestId: string, response: Response): Promise<AgentResult> {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      requestId,
      error: {
        code: "a2a_http_error",
        message: `A2A agent returned HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
        retryable: response.status >= 500 || response.status === 429,
        category: response.status >= 500 ? "dependency_failure" : "invalid_request",
      },
    };
  }
}

// ── SSE parsing ──────────────────────────────────────────────────────────

async function* parseSSE(response: Response): AsyncGenerator<unknown> {
  const reader = response.body!.getReader();
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
        try {
          yield JSON.parse(data);
        } catch {
          /* skip unparseable lines */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Type guards ──────────────────────────────────────────────────────────

function isStatusUpdate(
  event: A2AStreamEvent,
): event is Extract<A2AStreamEvent, { kind: "status-update" }> {
  return (event as Record<string, unknown>)["kind"] === "status-update";
}

function isArtifactUpdate(
  event: A2AStreamEvent,
): event is Extract<A2AStreamEvent, { kind: "artifact-update" }> {
  return (event as Record<string, unknown>)["kind"] === "artifact-update";
}

function isMessage(event: A2AStreamEvent): event is A2AMessage {
  return (event as Record<string, unknown>)["kind"] === "message";
}

// ── Part / artifact mapping ──────────────────────────────────────────────

function mapA2APartToAgentPart(part: A2APart): AgentPart {
  if (part.kind === "text") {
    return { kind: "text", text: part.text };
  }
  if (part.kind === "file") {
    const filePart: AgentPart = {
      kind: "file",
      name: part.file.name ?? "unnamed",
      mimeType: part.file.mimeType ?? "application/octet-stream",
    };
    if (part.file.uri !== undefined) (filePart as Record<string, unknown>)["uri"] = part.file.uri;
    if (part.file.bytes !== undefined) (filePart as Record<string, unknown>)["bytes"] = part.file.bytes;
    return filePart;
  }
  return { kind: "data", data: part.data };
}

function mapAgentPartToA2APart(part: AgentPart): A2APart {
  if (part.kind === "text") {
    return { kind: "text", text: part.text };
  }
  if (part.kind === "file") {
    const file: Record<string, string> = { name: part.name, mimeType: part.mimeType };
    if (part.uri !== undefined) file["uri"] = part.uri;
    if (part.bytes !== undefined) file["bytes"] = part.bytes;
    return { kind: "file", file };
  }
  return { kind: "data", data: part.data };
}

function mapA2AArtifactToAgentArtifact(artifact: A2AArtifact): AgentArtifact {
  const result: AgentArtifact = {
    artifactId: artifact.artifactId,
    parts: artifact.parts.map(mapA2APartToAgentPart),
  };
  if (artifact.name !== undefined) result.name = artifact.name;
  return result;
}

// ── Text extraction helpers ──────────────────────────────────────────────

function extractTextFromParts(parts: A2APart[]): string {
  return parts
    .filter((p): p is Extract<A2APart, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("");
}

function extractTextFromMessage(message: A2AMessage | undefined): string {
  if (!message) return "";
  return extractTextFromParts(message.parts);
}
