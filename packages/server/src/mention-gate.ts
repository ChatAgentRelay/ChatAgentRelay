import type { SlackMessageEvent } from "@chat-agent-relay/channel-slack";

export type MentionGateConfig = {
  mentionOnly: boolean;
  botUserId: string;
};

export function shouldProcessMessage(event: SlackMessageEvent, config: MentionGateConfig): boolean {
  if (event.channel_type === "im") return true;

  if (config.mentionOnly && !event.text.includes(`<@${config.botUserId}>`)) {
    return false;
  }

  return true;
}
