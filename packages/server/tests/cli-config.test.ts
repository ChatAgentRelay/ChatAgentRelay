import { afterEach, describe, expect, it } from "bun:test";
import { SqliteConfigStore } from "@chat-agent-relay/config-store";

describe("CLI config operations (direct DB)", () => {
  const dbs: SqliteConfigStore[] = [];
  function createDb(): SqliteConfigStore {
    const db = new SqliteConfigStore(":memory:", "test-cli-key-1234567890");
    dbs.push(db);
    return db;
  }
  afterEach(() => { for (const db of dbs) db.close(); dbs.length = 0; });

  it("adds and lists a channel", async () => {
    const db = createDb();
    await db.addChannel("slack-main", "slack", { botToken: "xoxb-test", appToken: "xapp-test" });
    const channels = await db.listChannels();
    expect(channels.length).toBe(1);
    expect(channels[0]!.name).toBe("slack-main");
    expect(channels[0]!.type).toBe("slack");
    expect(channels[0]!.config["botToken"]).toBe("xoxb-test");
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
    await db.addAgent("bot-b", "http", { endpoint: "http://b" });

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
    await db.addAgent("support", "langgraph", { endpoint: "http://lg:8123", assistantId: "cs" });
    await db.addAgent("coder", "acp", { command: "claude", workDir: "/workspace" });
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
