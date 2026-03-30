export type DiscordConfig = {
  token: string;
  defaultTenantId?: string | undefined;
  defaultWorkspaceId?: string | undefined;
  guildAllowlist?: string[] | undefined;
};

export type DiscordAuthor = {
  id: string;
  username: string;
  bot?: boolean | undefined;
};

export type DiscordMessageReference = {
  message_id?: string | undefined;
  channel_id?: string | undefined;
  guild_id?: string | undefined;
};

export type DiscordMessageEvent = {
  id: string;
  channel_id: string;
  guild_id?: string | undefined;
  author: DiscordAuthor;
  content: string;
  timestamp: string;
  message_reference?: DiscordMessageReference | undefined;
  thread?: { id: string; name?: string } | undefined;
};

export type DiscordGatewayPayload = {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
};

export type DiscordMessageUpdateEvent = {
  id: string;
  channel_id: string;
  guild_id?: string;
  author?: DiscordAuthor;
  content?: string;
  timestamp?: string;
  edited_timestamp?: string;
};

export type DiscordMessageDeleteEvent = {
  id: string;
  channel_id: string;
  guild_id?: string;
};

export type DiscordReactionEvent = {
  user_id: string;
  channel_id: string;
  message_id: string;
  guild_id?: string;
  emoji: { id?: string; name: string };
};

export type DiscordSendMessageResponse = {
  id: string;
  channel_id: string;
  content: string;
};

export type DiscordInteractionData = {
  id: string;
  name: string;
  type: number;
  options?: Array<{
    name: string;
    type: number;
    value: string | number | boolean;
  }>;
};

export type DiscordInteraction = {
  id: string;
  type: number;
  data?: DiscordInteractionData | undefined;
  guild_id?: string | undefined;
  channel_id: string;
  member?: { user: { id: string; username: string } } | undefined;
  user?: { id: string; username: string } | undefined;
  token: string;
  application_id: string;
};
