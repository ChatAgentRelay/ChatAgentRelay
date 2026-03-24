import { Database } from "bun:sqlite";
import type { LedgerStore, StoredCanonicalEvent } from "./types";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS canonical_events (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  channel_instance_id TEXT,
  conversation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  appended_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const CREATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_events_conversation ON canonical_events(conversation_id, occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_events_correlation ON canonical_events(correlation_id, occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_events_type ON canonical_events(event_type)",
];

const INSERT_EVENT = `
INSERT OR IGNORE INTO canonical_events (
  event_id, schema_version, event_type, tenant_id, workspace_id,
  channel, channel_instance_id, conversation_id, session_id,
  correlation_id, causation_id, occurred_at, actor_type, event_json
) VALUES (
  $event_id, $schema_version, $event_type, $tenant_id, $workspace_id,
  $channel, $channel_instance_id, $conversation_id, $session_id,
  $correlation_id, $causation_id, $occurred_at, $actor_type, $event_json
)`;

const SELECT_BY_ID = "SELECT event_json FROM canonical_events WHERE event_id = $event_id";

const SELECT_ALL = "SELECT event_json FROM canonical_events ORDER BY occurred_at ASC, rowid ASC";

type EventRow = { event_json: string };

export class SqliteLedgerStore implements LedgerStore {
  private readonly db: Database;
  private readonly insertStmt: ReturnType<Database["prepare"]>;
  private readonly selectByIdStmt: ReturnType<Database["prepare"]>;
  private readonly selectAllStmt: ReturnType<Database["prepare"]>;

  constructor(path: string = ":memory:") {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(CREATE_TABLE);
    for (const index of CREATE_INDEXES) {
      this.db.exec(index);
    }
    this.insertStmt = this.db.prepare(INSERT_EVENT);
    this.selectByIdStmt = this.db.prepare(SELECT_BY_ID);
    this.selectAllStmt = this.db.prepare(SELECT_ALL);
  }

  append(event: StoredCanonicalEvent): StoredCanonicalEvent | undefined {
    const existing = this.getById(event.event_id);
    if (existing) {
      return existing;
    }

    this.insertStmt.run({
      $event_id: event.event_id,
      $schema_version: event.schema_version,
      $event_type: event.event_type,
      $tenant_id: event.tenant_id,
      $workspace_id: event.workspace_id,
      $channel: event.channel,
      $channel_instance_id: event.channel_instance_id ?? null,
      $conversation_id: event.conversation_id,
      $session_id: event.session_id,
      $correlation_id: event.correlation_id,
      $causation_id: event.causation_id ?? null,
      $occurred_at: event.occurred_at,
      $actor_type: event.actor_type,
      $event_json: JSON.stringify(event),
    });

    return undefined;
  }

  getById(eventId: string): StoredCanonicalEvent | undefined {
    const row = this.selectByIdStmt.get({ $event_id: eventId }) as EventRow | null;
    if (!row) return undefined;
    return JSON.parse(row.event_json) as StoredCanonicalEvent;
  }

  getAll(): StoredCanonicalEvent[] {
    const rows = this.selectAllStmt.all() as EventRow[];
    return rows.map((row) => JSON.parse(row.event_json) as StoredCanonicalEvent);
  }

  close(): void {
    this.db.close();
  }
}
