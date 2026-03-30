import { afterEach, describe, expect, it } from "bun:test";
import { SqliteConfigStore } from "../src/config-database";

describe("SqliteConfigStore", () => {
  const dbs: SqliteConfigStore[] = [];
  function createDb(encKey?: string): SqliteConfigStore {
    const db = new SqliteConfigStore(":memory:", encKey);
    dbs.push(db);
    return db;
  }
  afterEach(() => { for (const db of dbs) db.close(); dbs.length = 0; });

  describe("channels", () => {
    it("adds and retrieves a channel", async () => {
      const db = createDb();
      const ch = await db.addChannel("slack-main", "slack", { botToken: "xoxb-123", appToken: "xapp-456" });
      expect(ch.name).toBe("slack-main");
      expect(ch.type).toBe("slack");
      expect(ch.config["botToken"]).toBe("xoxb-123");
      expect(ch.enabled).toBe(true);
    });

    it("lists all channels", async () => {
      const db = createDb();
      await db.addChannel("a", "slack", { botToken: "t1" });
      await db.addChannel("b", "discord", { botToken: "t2" });
      const list = await db.listChannels();
      expect(list.length).toBe(2);
    });

    it("updates channel config", async () => {
      const db = createDb();
      await db.addChannel("s1", "slack", { botToken: "old" });
      const updated = await db.updateChannel("s1", { config: { botToken: "new" } });
      expect(updated!.config["botToken"]).toBe("new");
    });

    it("enables/disables channel", async () => {
      const db = createDb();
      await db.addChannel("s1", "slack", { botToken: "t" });
      await db.updateChannel("s1", { enabled: false });
      const ch = await db.getChannel("s1");
      expect(ch!.enabled).toBe(false);
    });

    it("removes channel", async () => {
      const db = createDb();
      await db.addChannel("s1", "slack", {});
      expect(db.removeChannel("s1")).toBe(true);
      expect(await db.getChannel("s1")).toBeUndefined();
    });

    it("encrypts sensitive fields", async () => {
      const db = createDb("test-encryption-key-1234567890");
      await db.addChannel("enc", "slack", { botToken: "xoxb-secret", appToken: "xapp-secret", name: "public" });
      const ch = await db.getChannel("enc");
      expect(ch!.config["botToken"]).toBe("xoxb-secret");
      expect(ch!.config["appToken"]).toBe("xapp-secret");
      expect(ch!.config["name"]).toBe("public");
    });
  });

  describe("agents", () => {
    it("adds and retrieves an agent", async () => {
      const db = createDb();
      const ag = await db.addAgent("bot1", "a2a", { endpoint: "http://localhost:9000" });
      expect(ag.name).toBe("bot1");
      expect(ag.type).toBe("a2a");
      expect(ag.config["endpoint"]).toBe("http://localhost:9000");
    });

    it("lists agents", async () => {
      const db = createDb();
      await db.addAgent("a1", "a2a", {});
      await db.addAgent("a2", "acp", { command: "claude" });
      const list = await db.listAgents();
      expect(list.length).toBe(2);
    });

    it("updates agent", async () => {
      const db = createDb();
      await db.addAgent("a1", "langgraph", { endpoint: "old" });
      await db.updateAgent("a1", { config: { endpoint: "new" } });
      const ag = await db.getAgent("a1");
      expect(ag!.config["endpoint"]).toBe("new");
    });

    it("removes agent and its routes", async () => {
      const db = createDb();
      await db.addAgent("a1", "a2a", {});
      db.addRoute("default", null, "a1");
      expect(db.listRoutes().length).toBe(1);
      db.removeAgent("a1");
      expect(await db.getAgent("a1")).toBeUndefined();
      expect(db.listRoutes().length).toBe(0);
    });

    it("encrypts agent API keys", async () => {
      const db = createDb("agent-enc-key-1234567890123");
      await db.addAgent("lg", "langgraph", { endpoint: "http://lg", apiKey: "sk-secret" });
      const ag = await db.getAgent("lg");
      expect(ag!.config["apiKey"]).toBe("sk-secret");
      expect(ag!.config["endpoint"]).toBe("http://lg");
    });
  });

  describe("routes", () => {
    it("adds and lists routes", async () => {
      const db = createDb();
      await db.addAgent("a1", "a2a", {});
      db.addRoute("channel", "slack-main", "a1", 10);
      db.addRoute("default", null, "a1", 0);
      const routes = db.listRoutes();
      expect(routes.length).toBe(2);
      expect(routes[0]!.priority).toBe(10);
    });

    it("removes route", async () => {
      const db = createDb();
      await db.addAgent("a1", "a2a", {});
      const route = db.addRoute("default", null, "a1");
      expect(db.removeRoute(route.id)).toBe(true);
      expect(db.listRoutes().length).toBe(0);
    });

    it("enables/disables route", async () => {
      const db = createDb();
      await db.addAgent("a1", "a2a", {});
      const route = db.addRoute("default", null, "a1");
      db.updateRouteEnabled(route.id, false);
      expect(db.listRoutes()[0]!.enabled).toBe(false);
    });
  });

  describe("settings", () => {
    it("sets and gets settings", () => {
      const db = createDb();
      db.setSetting("api.port", "3000");
      expect(db.getSetting("api.port")).toBe("3000");
    });

    it("overwrites existing setting", () => {
      const db = createDb();
      db.setSetting("api.port", "3000");
      db.setSetting("api.port", "4000");
      expect(db.getSetting("api.port")).toBe("4000");
    });

    it("lists all settings", () => {
      const db = createDb();
      db.setSetting("a", "1");
      db.setSetting("b", "2");
      expect(db.listSettings().length).toBe(2);
    });

    it("deletes setting", () => {
      const db = createDb();
      db.setSetting("x", "1");
      expect(db.deleteSetting("x")).toBe(true);
      expect(db.getSetting("x")).toBeUndefined();
    });
  });
});
