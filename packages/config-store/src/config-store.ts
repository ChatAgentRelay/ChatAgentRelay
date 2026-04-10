import type {
  AgentRecord,
  AgentType,
  ChannelRecord,
  ChannelType,
  RouteMatchType,
  RouteRecord,
  SettingRecord,
} from "./types";

export interface ConfigStore {
  // ── Channels ───────────────────────────────────────────────────────
  addChannel(name: string, type: ChannelType, config: Record<string, unknown>): Promise<ChannelRecord>;
  getChannel(name: string): Promise<ChannelRecord | undefined>;
  listChannels(): Promise<ChannelRecord[]>;
  updateChannel(
    name: string,
    updates: { config?: Record<string, unknown>; enabled?: boolean },
  ): Promise<ChannelRecord | undefined>;
  removeChannel(name: string): boolean;

  // ── Agents ─────────────────────────────────────────────────────────
  addAgent(name: string, type: AgentType, config: Record<string, unknown>): Promise<AgentRecord>;
  getAgent(name: string): Promise<AgentRecord | undefined>;
  listAgents(): Promise<AgentRecord[]>;
  updateAgent(
    name: string,
    updates: { config?: Record<string, unknown>; enabled?: boolean },
  ): Promise<AgentRecord | undefined>;
  removeAgent(name: string): boolean;

  // ── Routes ─────────────────────────────────────────────────────────
  addRoute(matchType: RouteMatchType, matchValue: string | null, agentName: string, priority?: number): RouteRecord;
  listRoutes(): RouteRecord[];
  removeRoute(id: number): boolean;
  updateRouteEnabled(id: number, enabled: boolean): boolean;

  // ── Settings ───────────────────────────────────────────────────────
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  listSettings(): SettingRecord[];
  deleteSetting(key: string): boolean;

  // ── Lifecycle ──────────────────────────────────────────────────────
  close(): void;
}
