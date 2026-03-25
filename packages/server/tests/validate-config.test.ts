import { describe, it, expect } from "bun:test";
import { validateConfig, formatConfigErrors } from "../src/validate-config";
import type { ServerConfig } from "../src/config";

function validConfig(): ServerConfig {
  return {
    slack: { botToken: "xoxb-test-token", appToken: "xapp-test-token" },
    openai: { apiKey: "sk-test-key", model: "gpt-4o-mini", systemPrompt: "test" },
    cap: {
      tenantId: "t1",
      workspaceId: "ws1",
      routeId: "r1",
      sqlitePath: ":memory:",
      streaming: true,
      streamingIntervalMs: 800,
      apiPort: 3000,
    },
  };
}

describe("validateConfig", () => {
  it("returns no errors for valid config", () => {
    expect(validateConfig(validConfig())).toEqual([]);
  });

  it("detects missing SLACK_BOT_TOKEN", () => {
    const config = validConfig();
    config.slack.botToken = "";
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === "SLACK_BOT_TOKEN")).toBe(true);
  });

  it("detects wrong SLACK_BOT_TOKEN prefix", () => {
    const config = validConfig();
    config.slack.botToken = "xapp-wrong-type";
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === "SLACK_BOT_TOKEN" && e.message.includes("xoxb-"))).toBe(true);
  });

  it("detects missing SLACK_APP_TOKEN", () => {
    const config = validConfig();
    config.slack.appToken = "";
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === "SLACK_APP_TOKEN")).toBe(true);
  });

  it("detects wrong SLACK_APP_TOKEN prefix", () => {
    const config = validConfig();
    config.slack.appToken = "xoxb-wrong-type";
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === "SLACK_APP_TOKEN" && e.message.includes("xapp-"))).toBe(true);
  });

  it("detects missing OPENAI_API_KEY", () => {
    const config = validConfig();
    config.openai.apiKey = "";
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === "OPENAI_API_KEY")).toBe(true);
  });

  it("detects invalid port", () => {
    const config = validConfig();
    config.cap.apiPort = -1;
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === "CAP_API_PORT")).toBe(true);
  });

  it("detects streaming interval too low", () => {
    const config = validConfig();
    config.cap.streamingIntervalMs = 50;
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === "CAP_STREAMING_INTERVAL_MS")).toBe(true);
  });

  it("detects invalid OPENAI_BASE_URL", () => {
    const config = validConfig();
    config.openai.baseUrl = "not-a-url";
    const errors = validateConfig(config);
    expect(errors.some((e) => e.field === "OPENAI_BASE_URL")).toBe(true);
  });

  it("accepts valid OPENAI_BASE_URL", () => {
    const config = validConfig();
    config.openai.baseUrl = "http://localhost:8317";
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  it("reports multiple errors", () => {
    const config = validConfig();
    config.slack.botToken = "";
    config.slack.appToken = "";
    config.openai.apiKey = "";
    const errors = validateConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("formatConfigErrors", () => {
  it("formats errors with hints", () => {
    const output = formatConfigErrors([{
      field: "TEST_FIELD",
      message: "test error",
      hint: "test hint",
    }]);
    expect(output).toContain("TEST_FIELD");
    expect(output).toContain("test error");
    expect(output).toContain("test hint");
    expect(output).toContain("getting-started.md");
  });
});
