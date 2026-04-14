import type { ButtonAction, RichMessage } from "@chat-agent-relay/contract-harness";
import { buttonsToDiscordComponents } from "./button-components";
import { chunkText } from "./chunk-text";
import { richMessageToDiscordEmbed } from "./rich-message";
import type { DiscordSendMessageResponse } from "./types";

const DEFAULT_DISCORD_API_BASE = "https://discord.com/api/v10";

export type DiscordSenderConfig = {
  token: string;
  apiBase?: string;
};

export class DiscordSender {
  private readonly token: string;
  private readonly apiBase: string;

  constructor(config: DiscordSenderConfig) {
    this.token = config.token;
    this.apiBase = config.apiBase ?? DEFAULT_DISCORD_API_BASE;
  }

  async send(channelId: string, text: string, replyToMessageId?: string): Promise<{ providerMessageId: string }> {
    const chunks = chunkText(text);
    let lastResult: { providerMessageId: string } = { providerMessageId: "unknown" };

    for (let i = 0; i < chunks.length; i++) {
      lastResult = await this.postMessage(channelId, chunks[i]!, i === 0 ? replyToMessageId : undefined);
    }

    return lastResult;
  }

  private async postMessage(
    channelId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<{ providerMessageId: string }> {
    const payload: Record<string, unknown> = { content: text };
    if (replyToMessageId !== undefined) {
      payload["message_reference"] = { message_id: replyToMessageId };
    }

    const response = await fetch(`${this.apiBase}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${this.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord send message failed (${response.status}): ${errorBody}`);
    }

    const body = (await response.json()) as DiscordSendMessageResponse;
    return { providerMessageId: body.id };
  }

  async update(channelId: string, messageId: string, text: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/channels/${channelId}/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${this.token}`,
      },
      body: JSON.stringify({ content: text }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord update message failed (${response.status}): ${errorBody}`);
    }
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const encodedEmoji = encodeURIComponent(emoji);
    const response = await fetch(
      `${this.apiBase}/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${this.token}`,
        },
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord add reaction failed (${response.status}): ${errorBody}`);
    }
  }

  async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const encodedEmoji = encodeURIComponent(emoji);
    const response = await fetch(
      `${this.apiBase}/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bot ${this.token}`,
        },
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord remove reaction failed (${response.status}): ${errorBody}`);
    }
  }

  async sendTyping(channelId: string): Promise<void> {
    await fetch(`${this.apiBase}/channels/${channelId}/typing`, {
      method: "POST",
      headers: { Authorization: `Bot ${this.token}` },
    });
  }

  async deferInteraction(interactionId: string, interactionToken: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/interactions/${interactionId}/${interactionToken}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${this.token}` },
      body: JSON.stringify({ type: 5 }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord defer interaction failed (${response.status}): ${errorBody}`);
    }
  }

  async editInteractionResponse(applicationId: string, interactionToken: string, content: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${this.token}` },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord edit interaction response failed (${response.status}): ${errorBody}`);
    }
  }

  async sendButtons(
    channelId: string,
    text: string,
    buttons: ButtonAction[],
    replyToMessageId?: string,
  ): Promise<{ providerMessageId: string }> {
    const components = buttonsToDiscordComponents(buttons);
    const payload: Record<string, unknown> = { content: text, components };
    if (replyToMessageId !== undefined) {
      payload["message_reference"] = { message_id: replyToMessageId };
    }

    const response = await fetch(`${this.apiBase}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${this.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord send buttons failed (${response.status}): ${errorBody}`);
    }

    const body = (await response.json()) as DiscordSendMessageResponse;
    return { providerMessageId: body.id };
  }

  async sendRichMessage(
    channelId: string,
    message: RichMessage,
    replyToMessageId?: string,
  ): Promise<{ providerMessageId: string }> {
    const embed = richMessageToDiscordEmbed(message);
    const payload: Record<string, unknown> = {
      content: message.fallbackText,
      embeds: [embed],
    };
    if (replyToMessageId !== undefined) {
      payload["message_reference"] = { message_id: replyToMessageId };
    }

    const response = await fetch(`${this.apiBase}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${this.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Discord send rich message failed (${response.status}): ${errorBody}`);
    }

    const body = (await response.json()) as DiscordSendMessageResponse;
    return { providerMessageId: body.id };
  }

  createSendFn(channelId: string, replyToMessageId?: string): (text: string) => Promise<{ providerMessageId: string }> {
    return (text: string) => this.send(channelId, text, replyToMessageId);
  }
}
