import type { AgentRecord } from "@chat-agent-relay/config-store";
import { A2AAgentAdapter } from "@chat-agent-relay/backend-a2a";
import { ACPAgentAdapter } from "@chat-agent-relay/backend-acp";
import { GenericHttpBackend } from "@chat-agent-relay/backend-http";
import { LangGraphAdapter } from "@chat-agent-relay/backend-langgraph";
import type { AgentAdapter } from "@chat-agent-relay/contract-harness";

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function pickHeaders(obj: Record<string, unknown>): Record<string, string> | undefined {
  const v = obj["headers"];
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const v = obj[key];
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

function pickPermissionPolicy(
  obj: Record<string, unknown>,
): "auto-approve" | "deny" | "hitl" | undefined {
  const v = obj["permissionPolicy"];
  if (v === "auto-approve" || v === "deny" || v === "hitl") return v;
  return undefined;
}

export class AgentRegistry {
  private adapters = new Map<string, AgentAdapter>();

  async register(record: AgentRecord): Promise<void> {
    if (!record.enabled) {
      await this.unregister(record.name);
      return;
    }

    let adapter: AgentAdapter;
    try {
      adapter = await this.createAdapter(record);
    } catch (error) {
      console.log(
        `[AgentRegistry] failed to create adapter "${record.name}":`,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    await this.unregister(record.name);
    this.adapters.set(record.name, adapter);
    console.log(`[AgentRegistry] registered "${record.name}" (type=${record.type})`);
  }

  async unregister(name: string): Promise<void> {
    const existing = this.adapters.get(name);
    if (!existing) return;

    this.adapters.delete(name);

    if (existing instanceof ACPAgentAdapter) {
      try {
        await existing.shutdown();
      } catch (error) {
        console.log(
          `[AgentRegistry] ACP shutdown error for "${name}":`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  get(name: string): AgentAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }

  async shutdown(): Promise<void> {
    const names = this.list();
    for (const name of names) {
      await this.unregister(name);
    }
  }

  private async createAdapter(record: AgentRecord): Promise<AgentAdapter> {
    const { type, config } = record;

    switch (type) {
      case "a2a": {
        const endpoint = pickString(config, "endpoint");
        if (!endpoint) throw new Error("a2a config requires string endpoint");
        const timeoutMs = pickNumber(config, "timeoutMs");
        const headers = pickHeaders(config);
        return A2AAgentAdapter.create({
          endpoint,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(headers ? { headers } : {}),
        });
      }

      case "langgraph": {
        const endpoint = pickString(config, "endpoint");
        if (!endpoint) throw new Error("langgraph config requires string endpoint");
        const assistantId = pickString(config, "assistantId");
        const apiKey = pickString(config, "apiKey");
        const timeoutMs = pickNumber(config, "timeoutMs");
        const headers = pickHeaders(config);
        return LangGraphAdapter.create({
          endpoint,
          ...(assistantId ? { assistantId } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(headers ? { headers } : {}),
        });
      }

      case "acp": {
        const command = pickString(config, "command");
        if (!command) throw new Error("acp config requires string command");
        const args = pickStringArray(config, "args");
        const workDir = pickString(config, "workDir");
        const timeoutMs = pickNumber(config, "timeoutMs");
        const permissionPolicy = pickPermissionPolicy(config);
        return ACPAgentAdapter.create({
          command,
          ...(args ? { args } : {}),
          ...(workDir ? { workDir } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(permissionPolicy ? { permissionPolicy } : {}),
        });
      }

      case "http": {
        const endpoint = pickString(config, "endpoint");
        if (!endpoint) throw new Error("http config requires string endpoint");
        const timeoutMs = pickNumber(config, "timeoutMs");
        const headers = pickHeaders(config);
        const responseTextField = pickString(config, "responseTextField");
        const backend = await GenericHttpBackend.create({
          endpoint,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(headers ? { headers } : {}),
          ...(responseTextField ? { responseTextField } : {}),
        });
        return backend.asAgentAdapter();
      }

      default:
        throw new Error(`unsupported agent type: ${String(type)}`);
    }
  }
}
