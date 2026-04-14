import { describe, expect, it } from "bun:test";
import type { ButtonAction } from "@chat-agent-relay/contract-harness";
import { buttonsToSlackBlocks } from "../src/button-blocks";

describe("buttonsToSlackBlocks", () => {
  it("converts ButtonAction[] to section + actions Block Kit JSON", () => {
    const buttons: ButtonAction[] = [
      { id: "ok", label: "OK", style: "primary" },
      { id: "rm", label: "Remove", style: "danger", value: "remove-1" },
    ];
    const blocks = buttonsToSlackBlocks("Choose an action", buttons);

    expect(blocks).toHaveLength(2);

    const section = blocks[0] as Record<string, unknown>;
    expect(section["type"]).toBe("section");
    const sectionText = section["text"] as Record<string, unknown>;
    expect(sectionText["type"]).toBe("mrkdwn");
    expect(sectionText["text"]).toBe("Choose an action");

    const actions = blocks[1] as Record<string, unknown>;
    expect(actions["type"]).toBe("actions");
    const elements = actions["elements"] as Record<string, unknown>[];
    expect(elements).toHaveLength(2);

    expect(elements[0]).toEqual({
      type: "button",
      text: { type: "plain_text", text: "OK", emoji: true },
      action_id: "ok",
      style: "primary",
    });

    expect(elements[1]).toEqual({
      type: "button",
      text: { type: "plain_text", text: "Remove", emoji: true },
      action_id: "rm",
      style: "danger",
      value: "remove-1",
    });
  });

  it("omits value when ButtonAction has no value", () => {
    const buttons: ButtonAction[] = [{ id: "x", label: "X" }];
    const blocks = buttonsToSlackBlocks("Hi", buttons);
    const elements = (blocks[1] as Record<string, unknown>)["elements"] as Record<string, unknown>[];
    expect(elements[0]!["value"]).toBeUndefined();
  });

  it("maps non-danger styles to primary in Block Kit", () => {
    const buttons: ButtonAction[] = [{ id: "s", label: "Secondary", style: "secondary" }];
    const blocks = buttonsToSlackBlocks("t", buttons);
    const elements = (blocks[1] as Record<string, unknown>)["elements"] as Record<string, unknown>[];
    expect(elements[0]!["style"]).toBe("primary");
  });
});
