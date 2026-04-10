import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteConfigStore } from "@chat-agent-relay/config-store";
import { InMemoryEventLedgerStore } from "@chat-agent-relay/event-ledger";
import type { Server } from "bun";
import { AgentRegistry } from "../src/agent-registry";
import { startApiServer } from "../src/api";
import { createTeamsFactory } from "../src/channel-factories";
import { ChannelRegistry } from "../src/channel-registry";

type BunServer = Server<unknown>;

describe("CLI config operations (direct DB)", () => {
  const dbs: SqliteConfigStore[] = [];
  function createDb(): SqliteConfigStore {
    const db = new SqliteConfigStore(":memory:", "test-cli-key-1234567890");
    dbs.push(db);
    return db;
  }
  afterEach(() => {
    for (const db of dbs) db.close();
    dbs.length = 0;
  });

  it("adds and lists a channel", async () => {
    const db = createDb();
    await db.addChannel("slack-main", "slack", { botToken: "xoxb-test", appToken: "xapp-test" });
    const channels = await db.listChannels();
    expect(channels.length).toBe(1);
    expect(channels[0]!.name).toBe("slack-main");
    expect(channels[0]!.type).toBe("slack");
    expect(channels[0]!.config["botToken"]).toBe("xoxb-test");
  });

  it("supports teams channel records", async () => {
    const db = createDb();
    await db.addChannel("teams-main", "teams", {
      appId: "teams-app-id",
      appSecret: "teams-secret",
      tenantId: "tenant-123",
    });
    const channel = await db.getChannel("teams-main");
    expect(channel?.type).toBe("teams");
    expect(channel?.config["appId"]).toBe("teams-app-id");
    expect(channel?.config["tenantId"]).toBe("tenant-123");
  });

  it("supports telegram secret token records", async () => {
    const db = createDb();
    await db.addChannel("telegram-main", "telegram", {
      botToken: "telegram-bot-token",
      secretToken: "telegram-secret",
    });
    const channel = await db.getChannel("telegram-main");
    expect(channel?.type).toBe("telegram");
    expect(channel?.config["botToken"]).toBe("telegram-bot-token");
    expect(channel?.config["secretToken"]).toBe("telegram-secret");
  });

  it("supports lark encrypt key records", async () => {
    const db = createDb();
    await db.addChannel("lark-main", "lark", {
      appId: "lark-app-id",
      appSecret: "lark-secret",
      encryptKey: "lark-encrypt-key",
    });
    const channel = await db.getChannel("lark-main");
    expect(channel?.type).toBe("lark");
    expect(channel?.config["appId"]).toBe("lark-app-id");
    expect(channel?.config["encryptKey"]).toBe("lark-encrypt-key");
  });

  it("supports dingtalk secret records", async () => {
    const db = createDb();
    await db.addChannel("dingtalk-main", "dingtalk", {
      secret: "dingtalk-secret",
    });
    const channel = await db.getChannel("dingtalk-main");
    expect(channel?.type).toBe("dingtalk");
    expect(channel?.config["secret"]).toBe("dingtalk-secret");
  });

  it("supports whatsapp channel records", async () => {
    const db = createDb();
    await db.addChannel("whatsapp-main", "whatsapp", {
      phoneNumberId: "phone_123",
      accessToken: "wa-access-token",
      verifyToken: "wa-verify-token",
      appSecret: "wa-app-secret",
    });
    const channel = await db.getChannel("whatsapp-main");
    expect(channel?.type).toBe("whatsapp");
    expect(channel?.config["phoneNumberId"]).toBe("phone_123");
    expect(channel?.config["verifyToken"]).toBe("wa-verify-token");
  });

  it("adds and lists an agent", async () => {
    const db = createDb();
    await db.addAgent("my-bot", "a2a", { endpoint: "http://localhost:9000" });
    const agents = await db.listAgents();
    expect(agents.length).toBe(1);
    expect(agents[0]!.name).toBe("my-bot");
    expect(agents[0]!.type).toBe("a2a");
  });

  it("adds routes with different match types", async () => {
    const db = createDb();
    await db.addAgent("bot-a", "a2a", { endpoint: "http://a" });
    await db.addAgent("bot-b", "a2a", { endpoint: "http://b" });

    db.addRoute("channel", "slack-main", "bot-a", 10);
    db.addRoute("pattern", "^/code", "bot-b", 20);
    db.addRoute("default", null, "bot-a", 0);

    const routes = db.listRoutes();
    expect(routes.length).toBe(3);
    expect(routes[0]!.match_type).toBe("pattern");
    expect(routes[0]!.priority).toBe(20);
  });

  it("enables and disables an agent", async () => {
    const db = createDb();
    await db.addAgent("bot", "a2a", { endpoint: "http://x" });
    await db.updateAgent("bot", { enabled: false });
    let ag = await db.getAgent("bot");
    expect(ag!.enabled).toBe(false);
    await db.updateAgent("bot", { enabled: true });
    ag = await db.getAgent("bot");
    expect(ag!.enabled).toBe(true);
  });

  it("removes an agent and its routes", async () => {
    const db = createDb();
    await db.addAgent("bot", "a2a", { endpoint: "http://x" });
    db.addRoute("default", null, "bot");
    db.removeAgent("bot");
    expect(await db.getAgent("bot")).toBeUndefined();
    expect(db.listRoutes().length).toBe(0);
  });

  it("sets and gets config settings", () => {
    const db = createDb();
    db.setSetting("api.port", "4000");
    db.setSetting("streaming.enabled", "true");
    expect(db.getSetting("api.port")).toBe("4000");
    expect(db.getSetting("streaming.enabled")).toBe("true");
  });

  it("full workflow: channel + agent + route + settings", async () => {
    const db = createDb();

    await db.addChannel("my-slack", "slack", { botToken: "xoxb-123", appToken: "xapp-456" });
    await db.addAgent("support", "a2a", { endpoint: "http://agent:9000" });
    await db.addAgent("coder", "a2a", { endpoint: "http://coder:9001" });
    db.addRoute("channel", "my-slack", "support", 10);
    db.addRoute("pattern", "^/code", "coder", 20);
    db.addRoute("default", null, "support", 0);
    db.setSetting("api.port", "3000");
    db.setSetting("streaming.enabled", "true");

    const channels = await db.listChannels();
    const agents = await db.listAgents();
    const routes = db.listRoutes();
    const settings = db.listSettings();

    expect(channels.length).toBe(1);
    expect(agents.length).toBe(2);
    expect(routes.length).toBe(3);
    expect(settings.length).toBe(2);
  });
});

describe("CLI config operations (running API)", () => {
  const dbs: SqliteConfigStore[] = [];
  const servers: BunServer[] = [];
  const tempDirs: string[] = [];

  function createTempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "car-cli-test-"));
    tempDirs.push(dir);
    return join(dir, "car.db");
  }

  function createDbAt(path: string): SqliteConfigStore {
    const db = new SqliteConfigStore(path, "test-cli-key-1234567890");
    dbs.push(db);
    return db;
  }

  async function runCli(
    args: string[],
    env: Record<string, string>,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "src", "cli.ts"), ...args], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout, stderr, exitCode };
  }

  afterEach(() => {
    for (const server of servers) server.stop(true);
    servers.length = 0;
    for (const db of dbs) db.close();
    dbs.length = 0;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it("lists channels, agents, routes, and status against a running API", async () => {
    const dbPath = createTempDbPath();
    const configDb = createDbAt(dbPath);
    await configDb.addAgent("live-agent", "a2a", { endpoint: "http://localhost:9999" });
    await configDb.addChannel("live-webchat", "webchat", {});
    configDb.addRoute("default", null, "live-agent", 5);
    configDb.setSetting("api.port", "4311");

    const server = startApiServer({
      port: 4311,
      ledgerStore: new InMemoryEventLedgerStore(),
      configDb,
      agentRegistry: new AgentRegistry(),
      channelRegistry: new ChannelRegistry(async () => {}),
    });
    servers.push(server);

    const env = { CAR_DB_PATH: dbPath };

    const [channels, agents, routes, status] = await Promise.all([
      runCli(["channel", "list"], env),
      runCli(["agent", "list"], env),
      runCli(["route", "list"], env),
      runCli(["status"], env),
    ]);

    expect(channels.exitCode).toBe(0);
    expect(channels.stdout).toContain("live-webchat");
    expect(channels.stdout).toContain("webchat");

    expect(agents.exitCode).toBe(0);
    expect(agents.stdout).toContain("live-agent");
    expect(agents.stdout).toContain("a2a");

    expect(routes.exitCode).toBe(0);
    expect(routes.stdout).toContain("default");
    expect(routes.stdout).toContain("live-agent");

    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("Server: running (port 4311)");
    expect(status.stdout).toContain("Agents: 1");
    expect(status.stdout).toContain("Channels: 1");
  });

  it("uses DB api.port when CAR_API_PORT is unset and prefers CAR_API_PORT when set", async () => {
    const dbPath = createTempDbPath();
    const configDb = createDbAt(dbPath);
    await configDb.addAgent("db-agent", "a2a", { endpoint: "http://localhost:9999" });
    configDb.setSetting("api.port", "4322");

    const server = startApiServer({
      port: 4322,
      ledgerStore: new InMemoryEventLedgerStore(),
      configDb,
      agentRegistry: new AgentRegistry(),
      channelRegistry: new ChannelRegistry(async () => {}),
    });
    servers.push(server);

    const withoutEnv = await runCli(["status"], { CAR_DB_PATH: dbPath });
    expect(withoutEnv.exitCode).toBe(0);
    expect(withoutEnv.stdout).toContain("Server: running (port 4322)");

    const withEnvOverride = await runCli(["status"], { CAR_DB_PATH: dbPath, CAR_API_PORT: "4999" });
    expect(withEnvOverride.exitCode).toBe(0);
    expect(withEnvOverride.stdout).toContain("Server: not running (checked port 4999)");
    expect(withEnvOverride.stdout).toContain(`DB: ${dbPath}`);
  });

  it("accepts teams channels through the live API and masks appSecret", async () => {
    const dbPath = createTempDbPath();
    const configDb = createDbAt(dbPath);

    const channelRegistry = new ChannelRegistry(async () => {});
    channelRegistry.registerFactory("teams", createTeamsFactory());

    const server = startApiServer({
      port: 4333,
      ledgerStore: new InMemoryEventLedgerStore(),
      configDb,
      agentRegistry: new AgentRegistry(),
      channelRegistry,
    });
    servers.push(server);

    const response = await fetch("http://localhost:4333/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "teams-live",
        type: "teams",
        config: { appId: "teams-app-id", appSecret: "teams-secret", tenantId: "tenant-123" },
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { type: string; config: Record<string, unknown> };
    expect(body.type).toBe("teams");
    expect(body.config["appId"]).toBe("teams-app-id");
    expect(body.config["tenantId"]).toBe("tenant-123");
    expect(body.config["appSecret"]).toBe("team...***");

    const stored = await configDb.getChannel("teams-live");
    expect(stored?.config["appSecret"]).toBe("teams-secret");
  });
});
