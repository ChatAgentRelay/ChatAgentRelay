import { describe, expect, it } from "bun:test";
import type { SlackMessageEvent } from "@chat-agent-relay/channel-slack";
import { shouldProcessMessage } from "../src/mention-gate";

function makeEvent(overrides: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return {
    type: "message",
    channel: "C1234567890",
    user: "U9876543210",
    text: "Hello there",
    ts: "1710756000.000100",
    channel_type: "channel",
    ...overrides,
  };
}

const gateConfig = { mentionOnly: true, botUserId: "U_BOT_123" };

describe("shouldProcessMessage", () => {
  it("always processes DMs regardless of mention", () => {
    const event = makeEvent({ channel_type: "im", text: "hello no mention" });
    expect(shouldProcessMessage(event, gateConfig)).toBe(true);
  });

  it("blocks channel messages without mention when mentionOnly=true", () => {
    const event = makeEvent({ text: "hello no mention" });
    expect(shouldProcessMessage(event, gateConfig)).toBe(false);
  });

  it("allows channel messages with mention when mentionOnly=true", () => {
    const event = makeEvent({ text: "Hey <@U_BOT_123> help me" });
    expect(shouldProcessMessage(event, gateConfig)).toBe(true);
  });

  it("allows all channel messages when mentionOnly=false", () => {
    const event = makeEvent({ text: "hello no mention" });
    expect(shouldProcessMessage(event, { mentionOnly: false, botUserId: "U_BOT_123" })).toBe(true);
  });
});
