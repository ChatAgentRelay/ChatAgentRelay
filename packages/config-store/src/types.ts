export type ChannelType = "slack" | "discord" | "webchat";
export type AgentType = "a2a" | "langgraph" | "acp" | "http";

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
  slack: ["botToken", "appToken"],
  discord: ["botToken"],
  webchat: [],
  a2a: ["headers"],
  langgraph: ["apiKey", "headers"],
  acp: [],
  http: ["headers"],
};
