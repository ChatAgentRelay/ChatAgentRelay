import { describe, expect, it } from "bun:test";
import { checkAccessPolicy } from "../src/access-policy";
import type { AccessPolicyConfig } from "../src/access-policy";

function openConfig(): AccessPolicyConfig {
  return { dmPolicy: "open", channelPolicy: "open", channelAllowlist: [] };
}

describe("checkAccessPolicy", () => {
  it("allows DMs when dmPolicy is open", () => {
    const result = checkAccessPolicy("im", "D123", openConfig());
    expect(result.allowed).toBe(true);
  });

  it("blocks DMs when dmPolicy is disabled", () => {
    const result = checkAccessPolicy("im", "D123", {
      ...openConfig(),
      dmPolicy: "disabled",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("allows channel messages when channelPolicy is open", () => {
    const result = checkAccessPolicy("channel", "C123", openConfig());
    expect(result.allowed).toBe(true);
  });

  it("allows channel in allowlist when channelPolicy is allowlist", () => {
    const result = checkAccessPolicy("channel", "C123", {
      ...openConfig(),
      channelPolicy: "allowlist",
      channelAllowlist: ["C123", "C456"],
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks channel not in allowlist when channelPolicy is allowlist", () => {
    const result = checkAccessPolicy("channel", "C999", {
      ...openConfig(),
      channelPolicy: "allowlist",
      channelAllowlist: ["C123", "C456"],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("C999");
  });

  it("blocks all channel messages when channelPolicy is disabled", () => {
    const result = checkAccessPolicy("channel", "C123", {
      ...openConfig(),
      channelPolicy: "disabled",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
