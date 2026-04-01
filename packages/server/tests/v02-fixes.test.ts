import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SqliteConfigStore, RouteEngine } from "@chat-agent-relay/config-store";
import { InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { AgentRegistry } from "../src/agent-registry";
import { startApiServer } from "../src/api";
import { ChannelRegistry } from "../src/channel-registry";

type BunServer = Server<unknown>;

// ── REQ-1: CLI/API Response Structure ────────────────────────────────────
// Verifies that API returns raw arrays (not wrapped objects) for list endpoints.
describe("REQ-1: API returns raw arrays for list endpoints", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addAgent("test-agent", "a2a", { endpoint: "http://localhost:9999" });
    await configDb.addChannel("test-ch", "webchat", {});
    configDb.addRoute("default", null, "test-agent", 0);

    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});
    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("GET /api/agents returns a raw array", async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("test-agent");
  });

  it("GET /api/channels returns a raw array", async () => {
    const res = await fetch(`${baseUrl}/api/channels`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("test-ch");
  });

  it("GET /api/routes returns a raw array", async () => {
    const res = await fetch(`${baseUrl}/api/routes`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].agent_name).toBe("test-agent");
  });
});

// ── REQ-2: API addChannel Type Restriction ──────────────────────────────
describe("REQ-2: API addChannel accepts all 6 channel types", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;

  beforeAll(() => {
    configDb = new SqliteConfigStore(":memory:");
    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});
    server = startApiServer({ port: 0, ledgerStore: store, configDb, agentRegistry, channelRegistry });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("POST /api/channels with type 'telegram' returns 201", async () => {
    const res = await fetch(`${baseUrl}/api/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tg-ch", type: "telegram", config: { botToken: "fake" } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("telegram");
  });

  it("POST /api/channels with type 'lark' returns 201", async () => {
    const res = await fetch(`${baseUrl}/api/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "lark-ch", type: "lark", config: { appId: "id", appSecret: "secret" } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("lark");
  });

  it("POST /api/channels with type 'dingtalk' returns 201", async () => {
    const res = await fetch(`${baseUrl}/api/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dt-ch", type: "dingtalk", config: {} }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("dingtalk");
  });

  it("POST /api/channels with invalid type returns 400", async () => {
    const res = await fetch(`${baseUrl}/api/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad-ch", type: "invalid", config: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid channel type");
  });
});

// ── REQ-4: Route Hot-Reload ─────────────────────────────────────────────
describe("REQ-4: Route hot-reload via API", () => {
  let server: BunServer;
  let baseUrl: string;
  let configDb: SqliteConfigStore;
  let routeEngine: RouteEngine;

  beforeAll(async () => {
    configDb = new SqliteConfigStore(":memory:");
    await configDb.addAgent("agent-a", "a2a", { endpoint: "http://a" });
    routeEngine = new RouteEngine();
    routeEngine.load(configDb.listRoutes());

    const store = new InMemoryEventLedgerStore();
    const agentRegistry = new AgentRegistry();
    const channelRegistry = new ChannelRegistry(async () => {});
    server = startApiServer({
      port: 0,
      ledgerStore: store,
      configDb,
      agentRegistry,
      channelRegistry,
      routeEngine,
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    configDb.close();
  });

  it("POST /api/routes updates routeEngine immediately", async () => {
    // Before: no route match
    expect(routeEngine.resolve({ channelName: "test", messageText: "hi" })).toBeNull();

    // Add a default route via API
    const res = await fetch(`${baseUrl}/api/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match_type: "default", match_value: null, agent_name: "agent-a", priority: 0 }),
    });
    expect(res.status).toBe(201);

    // After: routeEngine should resolve the new route immediately
    const decision = routeEngine.resolve({ channelName: "test", messageText: "hi" });
    expect(decision).not.toBeNull();
    expect(decision!.agentName).toBe("agent-a");
  });

  it("DELETE /api/routes/:id updates routeEngine immediately", async () => {
    // Get the route we just created
    const routes = configDb.listRoutes();
    expect(routes.length).toBeGreaterThan(0);
    const routeId = routes[0]!.id;

    // Confirm it currently resolves
    expect(routeEngine.resolve({ channelName: "test", messageText: "hi" })).not.toBeNull();

    // Delete it via API
    const res = await fetch(`${baseUrl}/api/routes/${routeId}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    // After: routeEngine should no longer resolve
    expect(routeEngine.resolve({ channelName: "test", messageText: "hi" })).toBeNull();
  });
});
