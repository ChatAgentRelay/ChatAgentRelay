import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { PolicyConfig } from "../src/policy-engine";
import { createPolicyFn, loadPolicyConfig } from "../src/policy-engine";
import { loadPolicyFromFile, loadPolicyWithOverride } from "../src/policy-loader";

function makeEvent(text: string, overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
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
    occurred_at: "2026-04-01T10:15:00Z",
    actor_type: "end_user",
    actor: { id: "user-1" },
    payload: { text, ...(overrides.payload as Record<string, unknown> | undefined) },
    ...overrides,
  };
}

describe("createPolicyFn", () => {
  it("preserves legacy keyword rules", () => {
    const config = loadPolicyConfig(
      JSON.stringify({
        rules: [{ id: "r1", type: "keyword", pattern: "spam", action: "deny", reason: "spam_blocked" }],
      }),
    );
    const result = createPolicyFn(config)(makeEvent("This is SPAM content"));
    expect(result).toEqual({ decision: "deny", reason: "spam_blocked" });
  });

  it("preserves legacy regex rules", () => {
    const config = loadPolicyConfig(
      JSON.stringify({
        rules: [{ id: "r1", type: "regex", pattern: "\\b\\d{16}\\b", action: "deny" }],
      }),
    );
    const result = createPolicyFn(config)(makeEvent("card 1234567890123456"));
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("matched_rule:r1");
  });

  it("matches sender, channel, and content_length conditions", () => {
    const config: PolicyConfig = {
      rules: [
        {
          id: "sender-check",
          priority: 10,
          condition: {
            type: "and",
            conditions: [
              { type: "sender", value: "user-2" },
              { type: "channel", value: "slack" },
              { type: "content_length", min: 5, max: 20 },
            ],
          },
          action: "deny",
          reason: "sender-channel-length",
        },
      ],
    };

    const result = createPolicyFn(config)(
      makeEvent("hello there", { channel: "slack", actor: { id: "user-2" } as Record<string, unknown> }),
    );
    expect(result).toEqual({ decision: "deny", reason: "sender-channel-length" });
  });

  it("matches time_window conditions", () => {
    const config: PolicyConfig = {
      rules: [
        {
          id: "quiet-hours",
          priority: 1,
          condition: { type: "time_window", start: "10:00", end: "10:30" },
          action: "deny",
          reason: "quiet_hours",
        },
      ],
    };

    expect(createPolicyFn(config)(makeEvent("hello")).decision).toBe("deny");
    expect(createPolicyFn(config)(makeEvent("hello", { occurred_at: "2026-04-01T11:00:00Z" })).decision).toBe("allow");
  });

  it("supports and/or/not composition", () => {
    const config: PolicyConfig = {
      rules: [
        {
          id: "combo",
          priority: 1,
          condition: {
            type: "and",
            conditions: [
              {
                type: "or",
                conditions: [
                  { type: "keyword", pattern: "refund" },
                  { type: "keyword", pattern: "chargeback" },
                ],
              },
              {
                type: "not",
                condition: { type: "sender", value: "vip-user" },
              },
            ],
          },
          action: "deny",
          reason: "manual_review",
        },
      ],
    };

    expect(createPolicyFn(config)(makeEvent("refund please")).decision).toBe("deny");
    expect(
      createPolicyFn(config)(makeEvent("refund please", { actor: { id: "vip-user" } as Record<string, unknown> }))
        .decision,
    ).toBe("allow");
  });

  it("orders mandatory rules before non-mandatory regardless of priority", () => {
    const config: PolicyConfig = {
      rules: [
        {
          id: "allow-first",
          priority: 1,
          condition: { type: "keyword", pattern: "hello" },
          action: "allow",
        },
        {
          id: "deny-mandatory",
          priority: 999,
          mandatory: true,
          condition: { type: "keyword", pattern: "hello" },
          action: "deny",
          reason: "mandatory_block",
        },
      ],
    };

    const result = createPolicyFn(config)(makeEvent("hello world"));
    expect(result).toEqual({ decision: "deny", reason: "mandatory_block" });
  });

  it("applies ascending priority with stable first-match semantics", () => {
    const config: PolicyConfig = {
      rules: [
        {
          id: "later",
          priority: 20,
          condition: { type: "keyword", pattern: "hello" },
          action: "deny",
          reason: "later",
        },
        {
          id: "first",
          priority: 10,
          condition: { type: "keyword", pattern: "hello" },
          action: "deny",
          reason: "first",
        },
        {
          id: "first-stable",
          priority: 10,
          condition: { type: "keyword", pattern: "hello" },
          action: "deny",
          reason: "stable",
        },
      ],
    };

    const result = createPolicyFn(config)(makeEvent("hello"));
    expect(result.reason).toBe("first");
  });

  it("uses defaultDecision when no rules match", () => {
    const config: PolicyConfig = { rules: [], defaultDecision: "deny" };
    expect(createPolicyFn(config)(makeEvent("anything")).decision).toBe("deny");
  });
});

describe("loadPolicyFromFile", () => {
  it("loads YAML policy rules from file", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-policy-"));
    const file = join(dir, "policy.yaml");
    try {
      writeFileSync(
        file,
        `version: "1"\ndefaultDecision: deny\nrules:\n  - id: block-spam\n    priority: 1\n    action: deny\n    reason: spam\n    condition:\n      type: keyword\n      pattern: spam\n`,
      );
      const config = loadPolicyFromFile(file);
      expect(config.defaultDecision).toBe("deny");
      expect(config.rules[0]?.id).toBe("block-spam");
      expect(config.rules[0]?.condition).toEqual({ type: "keyword", pattern: "spam" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads YAML multiline reasons, flow sequences, comments, and nested conditions", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-policy-"));
    const file = join(dir, "policy.yaml");
    try {
      writeFileSync(
        file,
        `defaultDecision: allow\nrules:\n  - id: nested-rule\n    action: deny\n    reason: |\n      Manual review required\n      for suspicious sender and content.\n    condition:\n      type: and\n      conditions:\n        - type: sender\n          value: user-7 # sender under review\n        - type: or\n          conditions: [ { type: channel, value: slack }, { type: channel, value: teams } ]\n        - type: not\n          condition:\n            type: keyword\n            pattern: allowlist\n`,
      );
      const config = loadPolicyFromFile(file);
      expect(config.rules[0]?.reason).toBe("Manual review required\nfor suspicious sender and content.\n");
      expect(config.rules[0]?.condition).toEqual({
        type: "and",
        conditions: [
          { type: "sender", value: "user-7" },
          {
            type: "or",
            conditions: [
              { type: "channel", value: "slack" },
              { type: "channel", value: "teams" },
            ],
          },
          {
            type: "not",
            condition: { type: "keyword", pattern: "allowlist" },
          },
        ],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads YAML anchors and aliases", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-policy-"));
    const file = join(dir, "policy.yaml");
    try {
      writeFileSync(
        file,
        `sharedCondition: &shared\n  type: keyword\n  pattern: refund\nrules:\n  - id: refund-block\n    action: deny\n    reason: anchored\n    condition: *shared\n`,
      );
      const config = loadPolicyFromFile(file);
      expect(config.rules[0]?.condition).toEqual({ type: "keyword", pattern: "refund" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads JSON policy rules from file", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-policy-"));
    const file = join(dir, "policy.json");
    try {
      writeFileSync(
        file,
        JSON.stringify({ rules: [{ id: "json-rule", type: "keyword", pattern: "spam", action: "deny" }] }),
      );
      const config = loadPolicyFromFile(file);
      expect(config.rules[0]?.id).toBe("json-rule");
      expect(config.rules[0]?.condition).toEqual({ type: "keyword", pattern: "spam" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers file config over inline source when both are provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-policy-"));
    const file = join(dir, "policy.json");
    try {
      writeFileSync(
        file,
        JSON.stringify({ rules: [{ id: "file-rule", type: "keyword", pattern: "spam", action: "deny" }] }),
      );
      const config = loadPolicyWithOverride(
        file,
        JSON.stringify({ rules: [{ id: "inline-rule", type: "keyword", pattern: "ham", action: "deny" }] }),
      );
      expect(config.rules[0]?.id).toBe("file-rule");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on unsupported file format", () => {
    const dir = mkdtempSync(join(tmpdir(), "car-policy-"));
    const file = join(dir, "policy.txt");
    try {
      writeFileSync(file, "rules: []");
      expect(() => loadPolicyFromFile(file)).toThrow("Unsupported policy file format");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadPolicyConfig", () => {
  it("returns empty rules for undefined source", () => {
    const config = loadPolicyConfig(undefined);
    expect(config.rules).toEqual([]);
    expect(config.defaultDecision).toBeUndefined();
  });

  it("normalizes new-style rules", () => {
    const config = loadPolicyConfig(
      JSON.stringify({
        rules: [
          {
            id: "r1",
            priority: 5,
            mandatory: true,
            condition: { type: "sender", value: "user-1" },
            action: "deny",
          },
        ],
      }),
    );

    expect(config.rules[0]).toEqual({
      id: "r1",
      priority: 5,
      mandatory: true,
      condition: { type: "sender", value: "user-1" },
      action: "deny",
      reason: undefined,
    });
  });

  it("normalizes legacy rules into conditions", () => {
    const config = loadPolicyConfig(
      '{"rules": [{"id": "r1", "type": "keyword", "pattern": "spam", "action": "deny"}]}',
    );
    expect(config.rules[0]!.condition).toEqual({ type: "keyword", pattern: "spam" });
    expect(config.rules[0]!.priority).toBe(0);
  });

  it("throws on invalid JSON", () => {
    expect(() => loadPolicyConfig("not json")).toThrow("Failed to parse policy config");
  });

  it("throws when rules is not an array", () => {
    expect(() => loadPolicyConfig('{"rules": "not_array"}')).toThrow("'rules' array");
  });

  it("throws on unknown condition types", () => {
    expect(() =>
      loadPolicyConfig(
        JSON.stringify({
          rules: [{ id: "r1", condition: { type: "mystery" }, action: "deny" }],
        }),
      ),
    ).toThrow("unknown condition type");
  });

  it("throws on invalid regex pattern", () => {
    expect(() =>
      loadPolicyConfig(
        JSON.stringify({
          rules: [{ id: "r1", condition: { type: "regex", pattern: "[invalid" }, action: "deny" }],
        }),
      ),
    ).toThrow("invalid regex");
  });

  it("throws on invalid time window", () => {
    expect(() =>
      loadPolicyConfig(
        JSON.stringify({
          rules: [{ id: "r1", condition: { type: "time_window", start: "25:00", end: "10:00" }, action: "deny" }],
        }),
      ),
    ).toThrow("Invalid time value");
  });
});
