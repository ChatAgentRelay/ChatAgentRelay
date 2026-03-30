import type { ChannelRecord } from "@chat-agent-relay/config-store";
import {
  DEFAULT_INTENTS,
  DiscordGatewayConnection,
  DiscordIngress,
  DiscordSender,
} from "@chat-agent-relay/channel-discord";
import { SlackIngress, SlackSender, SlackSocketConnection } from "@chat-agent-relay/channel-slack";
import { WebChatIngress } from "@chat-agent-relay/channel-web-chat";

export type ChannelConnection = {
  name: string;
  type: string;
  tenantId: string;
  workspaceId: string;
  ingress: unknown;
  sender: unknown;
  connection: unknown;
  onMessage: (event: unknown) => Promise<void>;
};

export type MessageHandler = (
  channelName: string,
  ingress: unknown,
  sender: unknown,
  rawEvent: unknown,
) => Promise<void>;

export type ChannelRegistryOptions = {
  tenantId?: string;
  workspaceId?: string;
};

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export class ChannelRegistry {
  private channels = new Map<string, ChannelConnection>();
  private readonly messageHandler: MessageHandler;
  private readonly tenantId: string;
  private readonly workspaceId: string;

  constructor(messageHandler: MessageHandler, options?: ChannelRegistryOptions) {
    this.messageHandler = messageHandler;
    this.tenantId = options?.tenantId ?? "default_tenant";
    this.workspaceId = options?.workspaceId ?? "default_workspace";
  }

  async register(record: ChannelRecord): Promise<void> {
    if (!record.enabled) {
      await this.unregister(record.name);
      return;
    }

    try {
      await this.registerEnabled(record);
    } catch (error) {
      console.log(
        `[ChannelRegistry] failed to register "${record.name}":`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async registerEnabled(record: ChannelRecord): Promise<void> {
    await this.unregister(record.name);

    const { name, type, config } = record;
    const tenantId = this.tenantId;
    const workspaceId = this.workspaceId;

    const pending: {
      ingress: unknown;
      sender: unknown;
      connection: unknown;
    } = { ingress: null, sender: null, connection: null };

    const forward = async (rawEvent: unknown) => {
      try {
        await this.messageHandler(name, pending.ingress, pending.sender, rawEvent);
      } catch (error) {
        console.log(
          `[ChannelRegistry] message handler error (${name}):`,
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    switch (type) {
      case "slack": {
        const botToken = pickString(config, "botToken");
        const appToken = pickString(config, "appToken");
        if (!botToken || !appToken) {
          throw new Error("slack config requires botToken and appToken");
        }

        const ingress = await SlackIngress.create(tenantId, workspaceId);
        const sender = new SlackSender({ botToken });
        const socket = new SlackSocketConnection({
          appToken,
          onMessage: async (socketEvent: { payload: { event: Record<string, unknown> } }) => {
            await forward(socketEvent);
          },
          onError: (error: Error) => {
            console.log(`[ChannelRegistry] Slack socket error (${name}):`, error.message);
          },
          onReconnect: (attempt: number) => {
            console.log(`[ChannelRegistry] Slack reconnect (${name}) attempt ${attempt}`);
          },
        });

        pending.ingress = ingress;
        pending.sender = sender;
        pending.connection = socket;

        try {
          await socket.connect();
        } catch (error) {
          socket.disconnect();
          throw error;
        }
        break;
      }

      case "discord": {
        const botToken = pickString(config, "botToken");
        if (!botToken) {
          throw new Error("discord config requires botToken");
        }

        const intents = pickNumber(config, "intents") ?? DEFAULT_INTENTS;

        const ingress = await DiscordIngress.create(tenantId, workspaceId);
        const sender = new DiscordSender({ token: botToken });
        const gateway = new DiscordGatewayConnection({
          token: botToken,
          intents,
          onMessage: async (event) => {
            await forward(event);
          },
          onMessageUpdate: async (event) => {
            await forward(event);
          },
          onMessageDelete: async (event) => {
            await forward(event);
          },
          onReaction: async (event) => {
            await forward(event);
          },
          onInteraction: async (interaction) => {
            await forward(interaction);
          },
          onError: (error: Error) => {
            console.log(`[ChannelRegistry] Discord gateway error (${name}):`, error.message);
          },
          onReconnect: (attempt: number) => {
            console.log(`[ChannelRegistry] Discord reconnect (${name}) attempt ${attempt}`);
          },
        });

        pending.ingress = ingress;
        pending.sender = sender;
        pending.connection = gateway;

        try {
          await gateway.connect();
        } catch (error) {
          gateway.disconnect();
          throw error;
        }
        break;
      }

      case "webchat": {
        const ingress = await WebChatIngress.create();
        pending.ingress = ingress;
        pending.sender = null;
        pending.connection = null;
        break;
      }
    }

    const onMessage = async (event: unknown) => {
      await forward(event);
    };

    this.channels.set(name, {
      name,
      type,
      tenantId,
      workspaceId,
      ingress: pending.ingress,
      sender: pending.sender,
      connection: pending.connection,
      onMessage,
    });

    console.log(`[ChannelRegistry] registered "${name}" (type=${type})`);
  }

  async unregister(name: string): Promise<void> {
    const existing = this.channels.get(name);
    if (!existing) return;

    this.channels.delete(name);

    const conn = existing.connection;
    if (conn instanceof SlackSocketConnection || conn instanceof DiscordGatewayConnection) {
      try {
        conn.disconnect();
      } catch (error) {
        console.log(
          `[ChannelRegistry] disconnect error (${name}):`,
          error instanceof Error ? error.message : String(error),
        );
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
