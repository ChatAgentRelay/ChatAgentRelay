export type SlackConfig = {
  botToken: string;
  appToken: string;
  defaultTenantId?: string | undefined;
  defaultWorkspaceId?: string | undefined;
};

export type SlackMessageEvent = {
  type: "message";
  subtype?: string | undefined;
  channel: string;
  user: string;
  text: string;
  ts: string;
  team?: string | undefined;
  channel_type?: string | undefined;
  thread_ts?: string | undefined;
  bot_id?: string | undefined;
  bot_profile?: Record<string, unknown> | undefined;
};

export type SlackSocketEvent = {
  envelope_id: string;
  type: "events_api";
  payload: {
    event: SlackMessageEvent;
    event_id: string;
    team_id: string;
  };
  accepts_response_payload: boolean;
};

export type SlackAppMentionEvent = {
  type: "app_mention";
  channel: string;
  user: string;
  text: string;
  ts: string;
  team?: string | undefined;
  channel_type?: string | undefined;
  thread_ts?: string | undefined;
  event_ts?: string | undefined;
};

export type SlackMessageChangedEvent = {
  type: "message";
  subtype: "message_changed";
  channel: string;
  ts: string;
  message: {
    user: string;
    text: string;
    ts: string;
    team?: string;
    edited?: { user: string; ts: string };
  };
  previous_message?: {
    text: string;
    ts: string;
  };
};

export type SlackMessageDeletedEvent = {
  type: "message";
  subtype: "message_deleted";
  channel: string;
  ts: string;
  deleted_ts: string;
  previous_message?: {
    text: string;
    user?: string;
  };
};

export type SlackReactionEvent = {
  type: "reaction_added" | "reaction_removed";
  user: string;
  reaction: string;
  item: {
    type: "message";
    channel: string;
    ts: string;
  };
  item_user?: string;
  event_ts: string;
};

export type SlackPostMessageResponse = {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
};

export type SlackSlashCommandPayload = {
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name?: string;
  team_id: string;
  team_domain?: string;
};

export type SlackSlashCommandSocketEvent = {
  envelope_id: string;
  type: "slash_commands";
  payload: SlackSlashCommandPayload;
  accepts_response_payload: boolean;
};
