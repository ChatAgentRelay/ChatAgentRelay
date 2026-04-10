import type { ChannelRecord } from "@chat-agent-relay/config-store";
import type { ChannelAdapter } from "@chat-agent-relay/contract-harness";
import { isDisconnectable } from "@chat-agent-relay/contract-harness";
import { logger } from "./logger";

export type ChannelFactoryResult = {
  adapter: ChannelAdapter;
  connection?: unknown;
};

export type ChannelFactory = (
  config: Record<string, unknown>,
  tenantId: string,
  workspaceId: string,
  onMessage: (rawEvent: unknown) => Promise<void>,
) => Promise<ChannelFactoryResult>;

export type ChannelConnection = {
  name: string;
  type: string;
  tenantId: string;
  workspaceId: string;
  adapter: ChannelAdapter;
  connection: unknown;
  onMessage: (event: unknown) => Promise<void>;
};

export type MessageHandler = (channelName: string, adapter: ChannelAdapter, rawEvent: unknown) => Promise<void>;

export type ChannelRegistryOptions = {
  tenantId?: string;
  workspaceId?: string;
};

export class ChannelRegistry {
  private channels = new Map<string, ChannelConnection>();
  private factories = new Map<string, ChannelFactory>();
  private readonly messageHandler: MessageHandler;
  private readonly tenantId: string;
  private readonly workspaceId: string;

  constructor(messageHandler: MessageHandler, options?: ChannelRegistryOptions) {
    this.messageHandler = messageHandler;
    this.tenantId = options?.tenantId ?? "default_tenant";
    this.workspaceId = options?.workspaceId ?? "default_workspace";
  }

  registerFactory(type: string, factory: ChannelFactory): void {
    this.factories.set(type, factory);
  }

  async register(record: ChannelRecord): Promise<void> {
    if (!record.enabled) {
      await this.unregister(record.name);
      return;
    }

    try {
      await this.registerEnabled(record);
    } catch (error) {
      logger.error("Failed to register channel", {
        channel: record.name,
        channel_type: record.type,
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async registerEnabled(record: ChannelRecord): Promise<void> {
    await this.unregister(record.name);

    const { name, type, config } = record;
    const tenantId = this.tenantId;
    const workspaceId = this.workspaceId;

    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`Unsupported channel type: ${type}`);
    }

    let adapter!: ChannelAdapter;

    const forward = async (rawEvent: unknown) => {
      try {
        await this.messageHandler(name, adapter, rawEvent);
      } catch (error) {
        logger.error("Channel message handler error", {
          channel: name,
          error_message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const result = await factory(config, tenantId, workspaceId, forward);
    adapter = result.adapter;
    const connection = result.connection ?? null;

    this.channels.set(name, {
      name,
      type,
      tenantId,
      workspaceId,
      adapter,
      connection,
      onMessage: forward,
    });

    logger.info("Channel registered", { channel: name, channel_type: type });
  }

  async unregister(name: string): Promise<void> {
    const existing = this.channels.get(name);
    if (!existing) return;

    this.channels.delete(name);

    const conn = existing.connection;
    if (isDisconnectable(conn)) {
      try {
        conn.disconnect();
      } catch (error) {
        logger.error("Channel disconnect error", {
          channel: name,
          error_message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  get(name: string): ChannelConnection | undefined {
    return this.channels.get(name);
  }

  list(): string[] {
    return [...this.channels.keys()];
  }

  async shutdown(): Promise<void> {
    const names = this.list();
    for (const name of names) {
      await this.unregister(name);
    }
  }
}
