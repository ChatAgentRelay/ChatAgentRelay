export type ChannelType = "slack" | "discord" | "webchat" | "telegram" | "lark" | "dingtalk" | "teams" | "whatsapp";
export type AgentType = "a2a";

export type ChannelRecord = {
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type AgentRecord = {
  name: string;
  type: AgentType;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type RouteMatchType = "channel" | "pattern" | "default";

export type RouteRecord = {
  id: number;
  priority: number;
  match_type: RouteMatchType;
  match_value: string | null;
  agent_name: string;
  enabled: boolean;
  created_at: string;
};

export type SettingRecord = {
  key: string;
  value: string;
  updated_at: string;
};

export const SENSITIVE_FIELDS: Record<string, string[]> = {
  slack: ["botToken", "appToken", "signingSecret"],
  discord: ["botToken"],
  webchat: [],
  telegram: ["botToken", "secretToken"],
  lark: ["appId", "appSecret", "encryptKey"],
  dingtalk: ["appKey", "appSecret", "secret"],
  teams: ["appSecret"],
  whatsapp: ["accessToken", "appSecret"],
  a2a: ["headers"],
};
