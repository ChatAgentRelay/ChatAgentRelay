import { describe, expect, it } from "bun:test";
import type { ButtonAction } from "@chat-agent-relay/contract-harness";
import { buttonsToDiscordComponents } from "../src/button-components";

describe("buttonsToDiscordComponents", () => {
  it("converts ButtonAction[] to Discord action rows with type-2 buttons", () => {
    const buttons: ButtonAction[] = [
      { id: "primary_btn", label: "Go", style: "primary" },
      { id: "sec", label: "Later", style: "secondary" },
      { id: "del", label: "Delete", style: "danger" },
    ];
    const components = buttonsToDiscordComponents(buttons);

    expect(components).toHaveLength(1);
    const row = components[0] as Record<string, unknown>;
    expect(row["type"]).toBe(1);
    const inner = row["components"] as Record<string, unknown>[];
    expect(inner).toHaveLength(3);
    expect(inner[0]).toEqual({ type: 2, label: "Go", style: 1, custom_id: "primary_btn" });
    expect(inner[1]).toEqual({ type: 2, label: "Later", style: 2, custom_id: "sec" });
    expect(inner[2]).toEqual({ type: 2, label: "Delete", style: 4, custom_id: "del" });
  });

  it("splits into multiple action rows when more than five buttons", () => {
    const buttons: ButtonAction[] = Array.from({ length: 7 }, (_, i) => ({
      id: `b${i}`,
      label: `L${i}`,
    }));
    const components = buttonsToDiscordComponents(buttons);
    expect(components).toHaveLength(2);
    const row0 = (components[0] as Record<string, unknown>)["components"] as unknown[];
    const row1 = (components[1] as Record<string, unknown>)["components"] as unknown[];
    expect(row0).toHaveLength(5);
    expect(row1).toHaveLength(2);
  });

  it("defaults style to primary (1) when style is omitted", () => {
    const components = buttonsToDiscordComponents([{ id: "n", label: "N" }]);
    const inner = (components[0] as Record<string, unknown>)["components"] as Record<string, unknown>[];
    expect(inner[0]!["style"]).toBe(1);
  });
});
