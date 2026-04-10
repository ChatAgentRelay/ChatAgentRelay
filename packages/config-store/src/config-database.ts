import { Database } from "bun:sqlite";
import type { ConfigStore } from "./config-store";
import { EncryptionEngine } from "./encryption";
import {
  type AgentRecord,
  type AgentType,
  type ChannelRecord,
  type ChannelType,
  type RouteMatchType,
  type RouteRecord,
  SENSITIVE_FIELDS,
  type SettingRecord,
} from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
  name       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  name       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  priority    INTEGER NOT NULL DEFAULT 0,
  match_type  TEXT NOT NULL,
  match_value TEXT,
  agent_name  TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_name) REFERENCES agents(name)
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_routes_priority ON routes(priority DESC, id ASC)",
  "CREATE INDEX IF NOT EXISTS idx_routes_agent ON routes(agent_name)",
];

type RawRow = Record<string, unknown>;

export class SqliteConfigStore implements ConfigStore {
  private readonly db: Database;
  private readonly encryption: EncryptionEngine | null;

  constructor(path: string, encryptionKey?: string) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    for (const stmt of SCHEMA.split(";").filter((s) => s.trim())) {
      this.db.exec(stmt);
    }
    for (const idx of INDEXES) {
      this.db.exec(idx);
    }
    this.encryption = encryptionKey ? new EncryptionEngine(encryptionKey) : null;
  }

  async verifyEncryptionKey(): Promise<void> {
    if (!this.encryption) return;

    const allRows = [
      ...(this.db.prepare("SELECT name, type, config FROM channels").all() as RawRow[]),
      ...(this.db.prepare("SELECT name, type, config FROM agents").all() as RawRow[]),
    ];

    for (const row of allRows) {
      const type = row["type"] as string;
      const configJson = row["config"] as string;
      const fields = SENSITIVE_FIELDS[type] ?? [];
      if (fields.length === 0) continue;

      const parsed = JSON.parse(configJson) as Record<string, unknown>;
      const hasEncrypted = fields.some(
        (f) => typeof parsed[f] === "string" && this.encryption!.isEncrypted(parsed[f] as string),
      );
      if (!hasEncrypted) continue;

      await this.encryption.decryptFields(parsed, fields);
    }
  }

  // ── Channels ─────────────────────────────────────────────────────────

  async addChannel(name: string, type: ChannelType, config: Record<string, unknown>): Promise<ChannelRecord> {
    const stored = await this.encryptConfig(type, config);
    this.db
      .prepare("INSERT INTO channels (name, type, config) VALUES ($name, $type, $config)")
      .run({ $name: name, $type: type, $config: JSON.stringify(stored) });
    return (await this.getChannel(name))!;
  }

  async getChannel(name: string): Promise<ChannelRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM channels WHERE name = $name").get({ $name: name }) as RawRow | null;
    if (!row) return undefined;
    return this.rowToChannel(row);
  }

  async listChannels(): Promise<ChannelRecord[]> {
    const rows = this.db.prepare("SELECT * FROM channels ORDER BY name").all() as RawRow[];
    return Promise.all(rows.map((r) => this.rowToChannel(r)));
  }

  async updateChannel(
    name: string,
    updates: { config?: Record<string, unknown>; enabled?: boolean },
  ): Promise<ChannelRecord | undefined> {
    const existing = await this.getChannel(name);
    if (!existing) return undefined;
    if (updates.config !== undefined) {
      const stored = await this.encryptConfig(existing.type, updates.config);
      this.db
        .prepare("UPDATE channels SET config = $config, updated_at = datetime('now') WHERE name = $name")
        .run({ $name: name, $config: JSON.stringify(stored) });
    }
    if (updates.enabled !== undefined) {
      this.db
        .prepare("UPDATE channels SET enabled = $enabled, updated_at = datetime('now') WHERE name = $name")
        .run({ $name: name, $enabled: updates.enabled ? 1 : 0 });
    }
    return (await this.getChannel(name))!;
  }

  removeChannel(name: string): boolean {
    const result = this.db.prepare("DELETE FROM channels WHERE name = $name").run({ $name: name });
    return result.changes > 0;
  }

  // ── Agents ───────────────────────────────────────────────────────────

  async addAgent(name: string, type: AgentType, config: Record<string, unknown>): Promise<AgentRecord> {
    const stored = await this.encryptConfig(type, config);
    this.db
      .prepare("INSERT INTO agents (name, type, config) VALUES ($name, $type, $config)")
      .run({ $name: name, $type: type, $config: JSON.stringify(stored) });
    return (await this.getAgent(name))!;
  }

  async getAgent(name: string): Promise<AgentRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM agents WHERE name = $name").get({ $name: name }) as RawRow | null;
    if (!row) return undefined;
    return this.rowToAgent(row);
  }

  async listAgents(): Promise<AgentRecord[]> {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY name").all() as RawRow[];
    return Promise.all(rows.map((r) => this.rowToAgent(r)));
  }

  async updateAgent(
    name: string,
    updates: { config?: Record<string, unknown>; enabled?: boolean },
  ): Promise<AgentRecord | undefined> {
    const existing = await this.getAgent(name);
    if (!existing) return undefined;
    if (updates.config !== undefined) {
      const stored = await this.encryptConfig(existing.type, updates.config);
      this.db
        .prepare("UPDATE agents SET config = $config, updated_at = datetime('now') WHERE name = $name")
        .run({ $name: name, $config: JSON.stringify(stored) });
    }
    if (updates.enabled !== undefined) {
      this.db
        .prepare("UPDATE agents SET enabled = $enabled, updated_at = datetime('now') WHERE name = $name")
        .run({ $name: name, $enabled: updates.enabled ? 1 : 0 });
    }
    return (await this.getAgent(name))!;
  }

  removeAgent(name: string): boolean {
    this.db.prepare("DELETE FROM routes WHERE agent_name = $name").run({ $name: name });
    const result = this.db.prepare("DELETE FROM agents WHERE name = $name").run({ $name: name });
    return result.changes > 0;
  }

  // ── Routes ───────────────────────────────────────────────────────────

  addRoute(matchType: RouteMatchType, matchValue: string | null, agentName: string, priority = 0): RouteRecord {
    this.db
      .prepare(
        "INSERT INTO routes (priority, match_type, match_value, agent_name) VALUES ($priority, $match_type, $match_value, $agent_name)",
      )
      .run({ $priority: priority, $match_type: matchType, $match_value: matchValue, $agent_name: agentName });
    const row = this.db.prepare("SELECT * FROM routes ORDER BY id DESC LIMIT 1").get() as RawRow;
    return this.rowToRoute(row);
  }

  listRoutes(): RouteRecord[] {
    const rows = this.db.prepare("SELECT * FROM routes ORDER BY priority DESC, id ASC").all() as RawRow[];
    return rows.map((r) => this.rowToRoute(r));
  }

  removeRoute(id: number): boolean {
    const result = this.db.prepare("DELETE FROM routes WHERE id = $id").run({ $id: id });
    return result.changes > 0;
  }

  updateRouteEnabled(id: number, enabled: boolean): boolean {
    const result = this.db
      .prepare("UPDATE routes SET enabled = $enabled WHERE id = $id")
      .run({ $id: id, $enabled: enabled ? 1 : 0 });
    return result.changes > 0;
  }

  // ── Settings ─────────────────────────────────────────────────────────

  getSetting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = $key").get({ $key: key }) as {
      value: string;
    } | null;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = $value, updated_at = datetime('now')",
      )
      .run({ $key: key, $value: value });
  }

  listSettings(): SettingRecord[] {
    return this.db.prepare("SELECT * FROM settings ORDER BY key").all() as SettingRecord[];
  }

  deleteSetting(key: string): boolean {
    const result = this.db.prepare("DELETE FROM settings WHERE key = $key").run({ $key: key });
    return result.changes > 0;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async encryptConfig(type: string, config: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.encryption) return config;
    const fields = SENSITIVE_FIELDS[type] ?? [];
    return this.encryption.encryptFields(config, fields);
  }

  private async decryptConfig(type: string, configJson: string): Promise<Record<string, unknown>> {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(configJson) as Record<string, unknown>;
    } catch {
      throw new Error(`Corrupted config JSON for type '${type}' — the database may need to be recreated`);
    }
    if (!this.encryption) return parsed;
    const fields = SENSITIVE_FIELDS[type] ?? [];
    return this.encryption.decryptFields(parsed, fields);
  }

  private async rowToChannel(row: RawRow): Promise<ChannelRecord> {
    return {
      name: row["name"] as string,
      type: row["type"] as ChannelType,
      config: await this.decryptConfig(row["type"] as string, row["config"] as string),
      enabled: (row["enabled"] as number) === 1,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    };
  }

  private async rowToAgent(row: RawRow): Promise<AgentRecord> {
    return {
      name: row["name"] as string,
      type: row["type"] as AgentType,
      config: await this.decryptConfig(row["type"] as string, row["config"] as string),
      enabled: (row["enabled"] as number) === 1,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    };
  }

  private rowToRoute(row: RawRow): RouteRecord {
    return {
      id: row["id"] as number,
      priority: row["priority"] as number,
      match_type: row["match_type"] as RouteMatchType,
      match_value: row["match_value"] as string | null,
      agent_name: row["agent_name"] as string,
      enabled: (row["enabled"] as number) === 1,
      created_at: row["created_at"] as string,
    };
  }
}
