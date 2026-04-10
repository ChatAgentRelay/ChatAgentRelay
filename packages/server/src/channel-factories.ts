import { DingTalkIngress } from "@chat-agent-relay/channel-dingtalk";
import { DEFAULT_INTENTS, DiscordGatewayConnection, DiscordIngress } from "@chat-agent-relay/channel-discord";
import { LarkIngress } from "@chat-agent-relay/channel-lark";
import { SlackIngress, SlackSocketConnection } from "@chat-agent-relay/channel-slack";
import { TeamsIngress } from "@chat-agent-relay/channel-teams";
import { TelegramIngress } from "@chat-agent-relay/channel-telegram";
import { WebChatIngress } from "@chat-agent-relay/channel-web-chat";
import { WhatsAppIngress } from "@chat-agent-relay/channel-whatsapp";
import type { ChannelFactory } from "./channel-registry";
import { pickNumber, pickString } from "./config-helpers";
import { logger } from "./logger";

export function createSlackFactory(): ChannelFactory {
  return async (config, tenantId, workspaceId, onMessage) => {
    const botToken = pickString(config, "botToken");
    const appToken = pickString(config, "appToken");
    if (!botToken || !appToken) {
      throw new Error("slack config requires botToken and appToken");
    }

    const ingress = await SlackIngress.create(botToken, tenantId, workspaceId);

    const socket = new SlackSocketConnection({
      appToken,
      onMessage: async (socketEvent: { payload: { event: Record<string, unknown> } }) => {
        await onMessage(socketEvent);
      },
      onError: (error: Error) => {
        logger.error("Slack socket error", { error_message: error.message });
      },
      onReconnect: (attempt: number) => {
        logger.info("Slack socket reconnecting", { attempt });
      },
    });

    try {
      await socket.connect();
    } catch (error) {
      socket.disconnect();
      throw error;
    }

    return { adapter: ingress, connection: socket };
  };
}

export function createDiscordFactory(): ChannelFactory {
  return async (config, tenantId, workspaceId, onMessage) => {
    const botToken = pickString(config, "botToken");
    if (!botToken) {
      throw new Error("discord config requires botToken");
    }

    const intents = pickNumber(config, "intents") ?? DEFAULT_INTENTS;
    const ingress = await DiscordIngress.create(botToken, tenantId, workspaceId);

    const gateway = new DiscordGatewayConnection({
      token: botToken,
      intents,
      onMessage: async (event) => {
        await onMessage(event);
      },
      onMessageUpdate: async (event) => {
        await onMessage(event);
      },
      onMessageDelete: async (event) => {
        await onMessage(event);
      },
      onReaction: async (event) => {
        await onMessage(event);
      },
      onInteraction: async (interaction) => {
        await onMessage(interaction);
      },
      onError: (error: Error) => {
        logger.error("Discord gateway error", { error_message: error.message });
      },
      onReconnect: (attempt: number) => {
        logger.info("Discord gateway reconnecting", { attempt });
      },
    });

    try {
      await gateway.connect();
    } catch (error) {
      gateway.disconnect();
      throw error;
    }

    return { adapter: ingress, connection: gateway };
  };
}

export function createWebChatFactory(): ChannelFactory {
  return async () => {
    const adapter = await WebChatIngress.create();
    return { adapter };
  };
}

export function createTelegramFactory(): ChannelFactory {
  return async (config, tenantId, workspaceId) => {
    const botToken = pickString(config, "botToken");
    if (!botToken) {
      throw new Error("telegram config requires botToken");
    }
    const adapter = await TelegramIngress.create(botToken, tenantId, workspaceId);
    return { adapter };
  };
}

export function createLarkFactory(): ChannelFactory {
  return async (config, tenantId, workspaceId) => {
    const appId = pickString(config, "appId");
    const appSecret = pickString(config, "appSecret");
    if (!appId || !appSecret) {
      throw new Error("lark config requires appId and appSecret");
    }
    const adapter = await LarkIngress.create(appId, appSecret, tenantId, workspaceId);
    return { adapter };
  };
}

export function createDingTalkFactory(): ChannelFactory {
  return async (_config, tenantId, workspaceId) => {
    const adapter = await DingTalkIngress.create(tenantId, workspaceId);
    return { adapter };
  };
}

export function createTeamsFactory(): ChannelFactory {
  return async (config, tenantId, workspaceId) => {
    const appId = pickString(config, "appId");
    const appSecret = pickString(config, "appSecret");
    const tenantConfigId = pickString(config, "tenantId");
    if (!appId || !appSecret || !tenantConfigId) {
      throw new Error("teams config requires appId, appSecret, and tenantId");
    }
    const adapter = await TeamsIngress.create(appId, appSecret, tenantConfigId, tenantId, workspaceId);
    return { adapter };
  };
}

export function createWhatsAppFactory(): ChannelFactory {
  return async (config) => {
    const phoneNumberId = pickString(config, "phoneNumberId");
    const accessToken = pickString(config, "accessToken");
    if (!phoneNumberId || !accessToken) {
      throw new Error("whatsapp config requires phoneNumberId and accessToken");
    }
    const adapter = await WhatsAppIngress.create(phoneNumberId, accessToken);
    return { adapter };
  };
}
