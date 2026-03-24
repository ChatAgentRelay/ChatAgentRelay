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

export type SlackPostMessageResponse = {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
};
