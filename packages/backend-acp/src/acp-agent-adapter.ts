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
import type {
  ACPConfig,
  ACPContentBlock,
  ACPJsonRpcMessage,
  ACPRequestPermissionOutcome,
  ACPSessionUpdate,
  ACPStopReason,
} from "./types";

const ACP_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_TIMEOUT_MS = 120_000;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type SessionState = {
  sessionId: string;
  conversationId: string;
};

export class ACPAgentAdapter implements AgentAdapter {
  private readonly config: ACPConfig;
  private readonly validators: ContractHarnessValidators;
  private readonly timeoutMs: number;
  private readonly permissionPolicy: "auto-approve" | "deny" | "hitl";

  private process: ReturnType<typeof Bun.spawn> | null = null;
  private initialized = false;
  private nextId = 1;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private notificationHandlers: Array<(msg: ACPJsonRpcMessage) => void> = [];
  private requestHandlers: Array<(msg: ACPJsonRpcMessage) => ACPJsonRpcMessage | null> = [];
  private buffer = "";
  private sessions = new Map<string, SessionState>();
  private agentInfo: { name: string; version: string } | undefined;

  private constructor(config: ACPConfig, validators: ContractHarnessValidators) {
    this.config = config;
    this.validators = validators;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.permissionPolicy = config.permissionPolicy ?? "auto-approve";
  }

  static async create(config: ACPConfig): Promise<ACPAgentAdapter> {
    const validators = await ContractHarnessValidators.create();
    return new ACPAgentAdapter(config, validators);
  }

  describeCapabilities(): AgentCapabilities {
    return {
      streaming: true,
      hitl: this.permissionPolicy === "hitl",
      cancel: true,
      artifacts: false,
    };
  }

  async invoke(context: AgentInvocationContext): Promise<AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;

    try {
      await this.ensureReady();
      const sessionId = await this.resolveSession(context);

      const chunks: string[] = [];
      const toolCalls: Array<{ name: string; id: string }> = [];

      const notifHandler = (msg: ACPJsonRpcMessage) => {
        if (msg.method !== "session/update") return;
        const params = msg.params as { sessionId: string; update: ACPSessionUpdate } | undefined;
        if (!params || params.sessionId !== sessionId) return;

        const update = params.update;
        if (update.type === "message_chunk" && update.role === "assistant") {
          chunks.push((update as { content: string }).content);
        } else if (update.type === "tool_call_start") {
          toolCalls.push({ name: (update as { toolName: string }).toolName, id: (update as { toolCallId: string }).toolCallId });
        }
      };
      this.notificationHandlers.push(notifHandler);

      const permHandler = this.createPermissionHandler(sessionId);
      this.requestHandlers.push(permHandler);

      try {
        const result = await this.sendRequest("session/prompt", {
          sessionId,
          content: this.buildContent(context),
        }) as { stopReason: ACPStopReason };

        const text = chunks.join("");
        if (!text) {
          return {
            ok: false,
            requestId,
            error: {
              code: "empty_response",
              message: `ACP agent returned no text (stopReason: ${result.stopReason})`,
              retryable: false,
              category: "dependency_failure",
            },
          };
        }

        const event = this.buildCanonicalEvent(context.invocationEvent, text, requestId, sessionId);
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

        return { ok: true, event, requestId, sessionHandle: sessionId };
      } finally {
        this.notificationHandlers = this.notificationHandlers.filter((h) => h !== notifHandler);
        this.requestHandlers = this.requestHandlers.filter((h) => h !== permHandler);
      }
    } catch (error: unknown) {
      return this.wrapError(requestId, error);
    }
  }

  async *stream(context: AgentInvocationContext): AsyncGenerator<AgentEvent, AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;

    try {
      await this.ensureReady();
      const sessionId = await this.resolveSession(context);

      yield { type: "status", status: "working" };

      const chunks: string[] = [];
      let hitlPending = false;
      let hitlPrompt = "";

      type QueueItem = AgentEvent | { type: "__done"; result: { stopReason: ACPStopReason } } | { type: "__error"; error: Error };
      const queue: QueueItem[] = [];
      let queueResolve: (() => void) | null = null;

      const waitForItem = (): Promise<void> => {
        if (queue.length > 0) return Promise.resolve();
        return new Promise<void>((r) => { queueResolve = r; });
      };
      const pushItem = (item: QueueItem) => {
        queue.push(item);
        if (queueResolve) { queueResolve(); queueResolve = null; }
      };

      const notifHandler = (msg: ACPJsonRpcMessage) => {
        if (msg.method !== "session/update") return;
        const params = msg.params as { sessionId: string; update: ACPSessionUpdate } | undefined;
        if (!params || params.sessionId !== sessionId) return;

        const update = params.update;
        if (update.type === "message_chunk" && (update as { role: string }).role === "assistant") {
          const content = (update as { content: string }).content;
          chunks.push(content);
          pushItem({ type: "text_delta", content });
        } else if (update.type === "tool_call_start") {
          pushItem({ type: "status", status: "working", message: `Tool: ${(update as { toolName: string }).toolName}` });
        }
      };

      const permHandler = (msg: ACPJsonRpcMessage): ACPJsonRpcMessage | null => {
        if (msg.method !== "session/request_permission") return null;
        const params = msg.params as { sessionId: string; toolCall: { toolName: string; params?: Record<string, unknown> }; options: Array<{ id: string }> } | undefined;
        if (!params || params.sessionId !== sessionId) return null;

        if (this.permissionPolicy === "hitl") {
          hitlPending = true;
          hitlPrompt = `Agent requests permission to use tool: ${params.toolCall.toolName}`;
          pushItem({ type: "input_required", prompt: hitlPrompt });
          const allowOption = params.options.find((o) => o.id === "allow") ?? params.options[0];
          return {
            jsonrpc: "2.0",
            id: msg.id!,
            result: { outcome: allowOption?.id ?? "allow" },
          };
        }

        const outcome: ACPRequestPermissionOutcome = this.permissionPolicy === "auto-approve" ? "allow" : "deny";
        return { jsonrpc: "2.0", id: msg.id!, result: { outcome } };
      };

      this.notificationHandlers.push(notifHandler);
      this.requestHandlers.push(permHandler);

      const promptPromise = this.sendRequest("session/prompt", {
        sessionId,
        content: this.buildContent(context),
      }).then(
        (result) => pushItem({ type: "__done", result: result as { stopReason: ACPStopReason } }),
        (error) => pushItem({ type: "__error", error: error instanceof Error ? error : new Error(String(error)) }),
      );

      try {
        while (true) {
          await waitForItem();
          const item = queue.shift()!;

          if (item.type === "__error") {
            return this.wrapError(requestId, (item as { error: Error }).error);
          }

          if (item.type === "__done") {
            break;
          }

          yield item as AgentEvent;
        }

        const text = chunks.join("");
        if (!text) {
          return {
            ok: false,
            requestId,
            error: {
              code: "empty_response",
              message: "ACP agent produced no text content",
              retryable: false,
              category: "dependency_failure",
            },
          };
        }

        const event = this.buildCanonicalEvent(context.invocationEvent, text, requestId, sessionId);
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

        return {
          ok: true,
          event,
          requestId,
          sessionHandle: sessionId,
        };
      } finally {
        this.notificationHandlers = this.notificationHandlers.filter((h) => h !== notifHandler);
        this.requestHandlers = this.requestHandlers.filter((h) => h !== permHandler);
        await promptPromise;
      }
    } catch (error: unknown) {
      return this.wrapError(requestId, error);
    }
  }

  async resume(sessionHandle: string, input: AgentResumeInput): Promise<AgentResult> {
    const requestId = `req_${crypto.randomUUID()}`;

    try {
      await this.ensureReady();

      const chunks: string[] = [];
      const notifHandler = (msg: ACPJsonRpcMessage) => {
        if (msg.method !== "session/update") return;
        const params = msg.params as { sessionId: string; update: ACPSessionUpdate } | undefined;
        if (!params || params.sessionId !== sessionHandle) return;
        if (params.update.type === "message_chunk" && (params.update as { role: string }).role === "assistant") {
          chunks.push((params.update as { content: string }).content);
        }
      };
      this.notificationHandlers.push(notifHandler);

      const permHandler = this.createPermissionHandler(sessionHandle);
      this.requestHandlers.push(permHandler);

      try {
        await this.sendRequest("session/prompt", {
          sessionId: sessionHandle,
          content: [{ type: "text", text: input.messageText }],
        });

        const text = chunks.join("");
        if (!text) {
          return {
            ok: false,
            requestId,
            error: {
              code: "empty_response",
              message: "ACP agent returned no text on resume",
              retryable: false,
              category: "dependency_failure",
            },
          };
        }

        const event = this.buildCanonicalEvent(input.invocationEvent, text, requestId, sessionHandle);
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

        return { ok: true, event, requestId, sessionHandle };
      } finally {
        this.notificationHandlers = this.notificationHandlers.filter((h) => h !== notifHandler);
        this.requestHandlers = this.requestHandlers.filter((h) => h !== permHandler);
      }
    } catch (error: unknown) {
      return this.wrapError(requestId, error);
    }
  }

  async cancel(sessionHandle: string): Promise<void> {
    if (!this.process) return;
    this.sendNotification("session/cancel", { sessionId: sessionHandle });
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      try {
        this.process.stdin.end();
      } catch { /* ignore */ }
      this.process.kill();
      this.process = null;
    }
    this.initialized = false;
    this.sessions.clear();
    this.pendingRequests.clear();
  }

  // ── Process lifecycle ──────────────────────────────────────────────────

  private async ensureReady(): Promise<void> {
    if (!this.process) {
      await this.spawnAgent();
    }
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async spawnAgent(): Promise<void> {
    const proc = Bun.spawn([this.config.command, ...(this.config.args ?? [])], {
      cwd: this.config.workDir,
      env: { ...process.env, ...this.config.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });

    this.process = proc;
    this.buffer = "";

    this.readStdout(proc);
  }

  private async readStdout(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.buffer += decoder.decode(value, { stream: true });
          this.processBuffer();
        }
      } catch {
        /* process exited */
      } finally {
        reader.releaseLock();
      }
    })();
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: ACPJsonRpcMessage;
      try {
        msg = JSON.parse(trimmed) as ACPJsonRpcMessage;
      } catch {
        continue;
      }

      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
        continue;
      }

      if (msg.method && msg.id !== undefined) {
        for (const handler of this.requestHandlers) {
          const response = handler(msg);
          if (response) {
            this.writeMessage(response);
            break;
          }
        }
        continue;
      }

      if (msg.method && msg.id === undefined) {
        for (const handler of this.notificationHandlers) {
          handler(msg);
        }
      }
    }
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "chat-agent-relay", version: "0.1.0" },
    }) as { protocolVersion: string; capabilities: Record<string, unknown>; agentInfo?: { name: string; version: string } };

    this.agentInfo = result.agentInfo;
    this.initialized = true;
  }

  private async resolveSession(context: AgentInvocationContext): Promise<string> {
    if (context.sessionHandle) {
      const existing = this.sessions.get(context.sessionHandle);
      if (existing) return existing.sessionId;
    }

    const convId = context.invocationEvent.conversation_id;
    for (const [, session] of this.sessions) {
      if (session.conversationId === convId) {
        return session.sessionId;
      }
    }

    const result = await this.sendRequest("session/new", {
      workDir: this.config.workDir ?? process.cwd(),
      mcpServers: [],
    }) as { sessionId: string };

    this.sessions.set(result.sessionId, {
      sessionId: result.sessionId,
      conversationId: convId,
    });

    return result.sessionId;
  }

  // ── JSON-RPC transport ─────────────────────────────────────────────────

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0" as const, id, method, params };
    this.writeMessage(msg);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`ACP request timed out after ${this.timeoutMs}ms: ${method}`));
        }
      }, this.timeoutMs);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    this.writeMessage({ jsonrpc: "2.0" as const, method, params });
  }

  private writeMessage(msg: Record<string, unknown>): void {
    if (!this.process) throw new Error("ACP agent process not running");
    const line = JSON.stringify(msg) + "\n";
    this.process.stdin.write(line);
  }

  // ── Content builders ───────────────────────────────────────────────────

  private buildContent(context: AgentInvocationContext): ACPContentBlock[] {
    const blocks: ACPContentBlock[] = [{ type: "text", text: context.messageText }];
    if (context.parts) {
      for (const part of context.parts) {
        if (part.kind === "text" && part.text !== context.messageText) {
          blocks.push({ type: "text", text: part.text });
        } else if (part.kind === "file" && part.uri) {
          blocks.push({ type: "resource_link", uri: part.uri, name: part.name });
        }
      }
    }
    return blocks;
  }

  private createPermissionHandler(sessionId: string): (msg: ACPJsonRpcMessage) => ACPJsonRpcMessage | null {
    return (msg: ACPJsonRpcMessage): ACPJsonRpcMessage | null => {
      if (msg.method !== "session/request_permission") return null;
      const params = msg.params as { sessionId: string } | undefined;
      if (!params || params.sessionId !== sessionId) return null;

      const outcome: ACPRequestPermissionOutcome =
        this.permissionPolicy === "deny" ? "deny" : "allow";
      return { jsonrpc: "2.0", id: msg.id!, result: { outcome } };
    };
  }

  // ── Canonical event mapping ────────────────────────────────────────────

  private buildCanonicalEvent(
    inv: CanonicalEvent,
    text: string,
    requestId: string,
    sessionId: string,
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
      actor: { id: this.agentInfo?.name ?? "acp-agent" },
      payload: { text },
      provider_extensions: {
        acp: {
          request_id: requestId,
          session_id: sessionId,
          agent_name: this.agentInfo?.name,
          agent_version: this.agentInfo?.version,
        },
      },
    };
  }

  private wrapError(requestId: string, error: unknown): AgentResult {
    const isTimeout = error instanceof Error && error.message.includes("timed out");
    return {
      ok: false,
      requestId,
      error: {
        code: isTimeout ? "backend_timeout" : "backend_unavailable",
        message: error instanceof Error ? error.message : String(error),
        retryable: isTimeout,
        category: isTimeout ? "timeout" : "backend_unavailable",
      },
    };
  }
}
