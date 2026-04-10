import type { AgentRecord } from "@chat-agent-relay/config-store";
import type { AgentAdapter } from "@chat-agent-relay/contract-harness";
import { isShutdownable } from "@chat-agent-relay/contract-harness";
import { logger } from "./logger";

export type AgentFactory = (config: Record<string, unknown>) => Promise<AgentAdapter>;

export class AgentRegistry {
  private adapters = new Map<string, AgentAdapter>();
  private factories = new Map<string, AgentFactory>();

  registerFactory(type: string, factory: AgentFactory): void {
    this.factories.set(type, factory);
  }

  async register(record: AgentRecord): Promise<void> {
    if (!record.enabled) {
      await this.unregister(record.name);
      return;
    }

    let adapter: AgentAdapter;
    try {
      adapter = await this.createAdapter(record);
    } catch (error) {
      logger.error("Failed to create agent adapter", {
        agent: record.name,
        agent_type: record.type,
        error_message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    await this.unregister(record.name);
    this.adapters.set(record.name, adapter);
    logger.info("Agent registered", { agent: record.name, agent_type: record.type });
  }

  async unregister(name: string): Promise<void> {
    const existing = this.adapters.get(name);
    if (!existing) return;

    this.adapters.delete(name);

    if (isShutdownable(existing)) {
      try {
        await existing.shutdown();
      } catch (error) {
        logger.error("Agent shutdown error", {
          agent: name,
          error_message: error instanceof Error ? error.message : String(error),
        });
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
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`unsupported agent type: ${String(type)}`);
    }
    return factory(config);
  }
}
