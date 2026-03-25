import { describe, it, expect } from "bun:test";
import { createPolicyFn, loadPolicyConfig } from "../src/policy-engine";
import type { PolicyConfig } from "../src/policy-engine";
import type { CanonicalEvent } from "@cap/contract-harness";

function makeEvent(text: string): CanonicalEvent {
  return {
    event_id: "evt_test",
    schema_version: "v1alpha1",
    event_type: "message.received",
    tenant_id: "t1",
    workspace_id: "ws1",
    channel: "test",
    channel_instance_id: "ch1",
    conversation_id: "conv1",
    session_id: "sess1",
    correlation_id: "corr1",
    occurred_at: new Date().toISOString(),
    actor_type: "end_user",
    payload: { text },
  };
}

describe("createPolicyFn", () => {
  it("allows messages with no matching rules", () => {
    const config: PolicyConfig = {
      rules: [{ id: "r1", type: "keyword", pattern: "spam", action: "deny" }],
    };
    const policyFn = createPolicyFn(config);
    const result = policyFn(makeEvent("hello world"));
    expect(result.decision).toBe("allow");
  });

  it("denies messages matching keyword rule (case-insensitive)", () => {
    const config: PolicyConfig = {
      rules: [{ id: "r1", type: "keyword", pattern: "spam", action: "deny", reason: "spam_blocked" }],
    };
    const policyFn = createPolicyFn(config);
    const result = policyFn(makeEvent("This is SPAM content"));
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("spam_blocked");
  });

  it("denies messages matching regex rule", () => {
    const config: PolicyConfig = {
      rules: [{ id: "r1", type: "regex", pattern: "\\b\\d{16}\\b", action: "deny", reason: "credit_card_detected" }],
    };
    const policyFn = createPolicyFn(config);
    const result = policyFn(makeEvent("My card is 1234567890123456"));
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("credit_card_detected");
  });

  it("allows messages that do not match regex", () => {
    const config: PolicyConfig = {
      rules: [{ id: "r1", type: "regex", pattern: "\\b\\d{16}\\b", action: "deny" }],
    };
    const policyFn = createPolicyFn(config);
    const result = policyFn(makeEvent("My number is 12345"));
    expect(result.decision).toBe("allow");
  });

  it("checks rules in order and returns first match", () => {
    const config: PolicyConfig = {
      rules: [
        { id: "r1", type: "keyword", pattern: "hello", action: "deny", reason: "first" },
        { id: "r2", type: "keyword", pattern: "hello", action: "deny", reason: "second" },
      ],
    };
    const policyFn = createPolicyFn(config);
    const result = policyFn(makeEvent("hello"));
    expect(result.reason).toBe("first");
  });

  it("uses defaultDecision when set to deny", () => {
    const config: PolicyConfig = {
      rules: [],
      defaultDecision: "deny",
    };
    const policyFn = createPolicyFn(config);
    const result = policyFn(makeEvent("anything"));
    expect(result.decision).toBe("deny");
  });

  it("generates reason from rule id when not specified", () => {
    const config: PolicyConfig = {
      rules: [{ id: "profanity_filter", type: "keyword", pattern: "badword", action: "deny" }],
    };
    const policyFn = createPolicyFn(config);
    const result = policyFn(makeEvent("this has badword"));
    expect(result.reason).toBe("matched_rule:profanity_filter");
  });
});

describe("loadPolicyConfig", () => {
  it("returns empty rules for undefined source", () => {
    const config = loadPolicyConfig(undefined);
    expect(config.rules).toEqual([]);
  });

  it("parses valid JSON config", () => {
    const json = JSON.stringify({
      rules: [
        { id: "r1", type: "keyword", pattern: "spam", action: "deny" },
      ],
    });
    const config = loadPolicyConfig(json);
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]!.id).toBe("r1");
  });

  it("throws on invalid JSON", () => {
    expect(() => loadPolicyConfig("not json")).toThrow("Failed to parse policy config");
  });

  it("throws when rules is not an array", () => {
    expect(() => loadPolicyConfig('{"rules": "not_array"}')).toThrow("'rules' array");
  });

  it("throws on missing rule id", () => {
    expect(() => loadPolicyConfig('{"rules": [{"type": "keyword", "pattern": "x"}]}')).toThrow("non-empty 'id'");
  });

  it("throws on invalid rule type", () => {
    expect(() => loadPolicyConfig('{"rules": [{"id": "r1", "type": "bad", "pattern": "x"}]}')).toThrow("'keyword' or 'regex'");
  });

  it("throws on invalid regex pattern", () => {
    expect(() => loadPolicyConfig('{"rules": [{"id": "r1", "type": "regex", "pattern": "[invalid"}]}')).toThrow("invalid regex");
  });

  it("parses defaultDecision", () => {
    const config = loadPolicyConfig('{"rules": [], "defaultDecision": "deny"}');
    expect(config.defaultDecision).toBe("deny");
  });
});
