import { beforeAll, describe, expect, it } from "bun:test";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";
import { SlackIngress } from "../src/slack-ingress";
import type { SlackSlashCommandPayload } from "../src/types";

function sampleSlashCommand(): SlackSlashCommandPayload {
  return {
    command: "/ask",
    text: "what is the weather",
    response_url: "https://hooks.slack.com/commands/T0001/resp",
    trigger_id: "trigger_123456.abcdef",
    user_id: "U9876543210",
    user_name: "testuser",
    channel_id: "C1234567890",
    channel_name: "general",
    team_id: "T0001",
    team_domain: "acme",
  };
}

describe("Slack slash command canonicalization", () => {
  let ingress: SlackIngress;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    ingress = await SlackIngress.create("xoxb-test-token", "tenant_acme", "ws_support");
    validators = await ContractHarnessValidators.create();
  });

  it("canonicalizes a valid slash command payload", () => {
    const result = ingress.canonicalizeCommand(sampleSlashCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("command.received");
    expect(result.event.channel).toBe("slack");
    expect(result.event.actor_type).toBe("end_user");
    expect(result.event.payload["command_name"]).toBe("ask");
    expect(result.event.payload["text"]).toBe("what is the weather");

    const v = validators.validateEvent(result.event);
    expect(v.ok).toBe(true);
  });

  it("strips the leading / from command name", () => {
    const result = ingress.canonicalizeCommand(sampleSlashCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.payload["command_name"]).toBe("ask");
  });

  it("preserves command without leading / unchanged", () => {
    const cmd = { ...sampleSlashCommand(), command: "deploy" };
    const result = ingress.canonicalizeCommand(cmd);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.payload["command_name"]).toBe("deploy");
  });

  it("includes trigger_id in idempotency key", () => {
    const result = ingress.canonicalizeCommand(sampleSlashCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.idempotencyKey).toBe("slack:tenant_acme:cmd:trigger_123456.abcdef");
  });

  it("has correct event_type command.received", () => {
    const result = ingress.canonicalizeCommand(sampleSlashCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.event_type).toBe("command.received");
  });

  it("includes Slack metadata in provider_extensions", () => {
    const result = ingress.canonicalizeCommand(sampleSlashCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = result.event.provider_extensions as Record<string, Record<string, unknown>>;
    expect(ext["slack"]).toBeDefined();
    expect(ext["slack"]!["command"]).toBe("/ask");
    expect(ext["slack"]!["response_url"]).toBe("https://hooks.slack.com/commands/T0001/resp");
    expect(ext["slack"]!["trigger_id"]).toBe("trigger_123456.abcdef");
    expect(ext["slack"]!["channel_id"]).toBe("C1234567890");
    expect(ext["slack"]!["team_id"]).toBe("T0001");
  });

  it("rejects payload with missing command field", () => {
    const invalid = { text: "hello", user_id: "U1", channel_id: "C1", trigger_id: "t1" };
    const result = ingress.canonicalizeCommand(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_slash_command");
  });

  it("rejects payload with missing user_id", () => {
    const invalid = { command: "/ask", text: "hello", channel_id: "C1", trigger_id: "t1" };
    const result = ingress.canonicalizeCommand(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_slash_command");
  });

  it("rejects payload with missing channel_id", () => {
    const invalid = { command: "/ask", text: "hello", user_id: "U1", trigger_id: "t1" };
    const result = ingress.canonicalizeCommand(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_slash_command");
  });

  it("rejects null input", () => {
    const result = ingress.canonicalizeCommand(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_slash_command");
  });

  it("maps user to actor and identity_refs", () => {
    const result = ingress.canonicalizeCommand(sampleSlashCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actor = result.event.actor as Record<string, string>;
    expect(actor["id"]).toBe("U9876543210");
    expect(actor["display_name"]).toBe("testuser");
    const refs = result.event.identity_refs as Record<string, string>;
    expect(refs["channel_user_id"]).toBe("U9876543210");
  });
});
