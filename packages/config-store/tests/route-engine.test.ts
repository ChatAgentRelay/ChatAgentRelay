import { describe, expect, it } from "bun:test";
import { RouteEngine } from "../src/route-engine";
import type { RouteRecord } from "../src/types";

function route(
  overrides: Partial<RouteRecord> & { match_type: RouteRecord["match_type"]; agent_name: string },
): RouteRecord {
  return {
    id: 1,
    priority: 0,
    match_value: null,
    enabled: true,
    created_at: "2026-01-01",
    ...overrides,
  };
}

describe("RouteEngine", () => {
  it("matches by channel name", () => {
    const engine = new RouteEngine();
    engine.load([route({ id: 1, match_type: "channel", match_value: "slack-main", agent_name: "bot-a" })]);
    const result = engine.resolve({ channelName: "slack-main", messageText: "hello" });
    expect(result).not.toBeNull();
    expect(result!.agentName).toBe("bot-a");
    expect(result!.matchType).toBe("channel");
  });

  it("matches by pattern", () => {
    const engine = new RouteEngine();
    engine.load([route({ id: 1, match_type: "pattern", match_value: "^/code", agent_name: "coder" })]);
    const result = engine.resolve({ channelName: "any", messageText: "/code review this" });
    expect(result!.agentName).toBe("coder");
  });

  it("does not match wrong pattern", () => {
    const engine = new RouteEngine();
    engine.load([route({ id: 1, match_type: "pattern", match_value: "^/code", agent_name: "coder" })]);
    const result = engine.resolve({ channelName: "any", messageText: "hello world" });
    expect(result).toBeNull();
  });

  it("falls back to default route", () => {
    const engine = new RouteEngine();
    engine.load([
      route({ id: 1, match_type: "channel", match_value: "slack-main", agent_name: "bot-a" }),
      route({ id: 2, match_type: "default", agent_name: "bot-default" }),
    ]);
    const result = engine.resolve({ channelName: "discord-main", messageText: "hello" });
    expect(result!.agentName).toBe("bot-default");
    expect(result!.matchType).toBe("default");
  });

  it("channel match takes priority over default", () => {
    const engine = new RouteEngine();
    engine.load([
      route({ id: 1, match_type: "default", agent_name: "fallback", priority: 0 }),
      route({ id: 2, match_type: "channel", match_value: "slack-x", agent_name: "specific", priority: 0 }),
    ]);
    const result = engine.resolve({ channelName: "slack-x", messageText: "hi" });
    expect(result!.agentName).toBe("specific");
  });

  it("pattern match takes priority over default", () => {
    const engine = new RouteEngine();
    engine.load([
      route({ id: 1, match_type: "default", agent_name: "fallback" }),
      route({ id: 2, match_type: "pattern", match_value: "urgent", agent_name: "priority-bot" }),
    ]);
    const result = engine.resolve({ channelName: "any", messageText: "this is urgent" });
    expect(result!.agentName).toBe("priority-bot");
  });

  it("returns null when no routes match", () => {
    const engine = new RouteEngine();
    engine.load([route({ id: 1, match_type: "channel", match_value: "slack-x", agent_name: "bot" })]);
    const result = engine.resolve({ channelName: "discord-y", messageText: "hello" });
    expect(result).toBeNull();
  });

  it("skips disabled routes", () => {
    const engine = new RouteEngine();
    engine.load([route({ id: 1, match_type: "default", agent_name: "bot", enabled: false })]);
    const result = engine.resolve({ channelName: "any", messageText: "hello" });
    expect(result).toBeNull();
  });

  it("handles invalid regex gracefully", () => {
    const engine = new RouteEngine();
    engine.load([route({ id: 1, match_type: "pattern", match_value: "[invalid", agent_name: "bot" })]);
    const result = engine.resolve({ channelName: "any", messageText: "hello" });
    expect(result).toBeNull();
  });
});
