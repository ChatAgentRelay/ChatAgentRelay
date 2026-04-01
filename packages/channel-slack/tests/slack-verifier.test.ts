import { describe, expect, it } from "bun:test";
import { SlackWebhookVerifier } from "../src/slack-verifier";

describe("SlackWebhookVerifier", () => {
  it("accepts a valid Slack signature", async () => {
    const verifier = new SlackWebhookVerifier("signing-secret", () => 1_710_756_000_000);
    const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const timestamp = "1710756000";
    const signature = verifier.sign(timestamp, body);

    const request = new Request("https://example.test/api/slack/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body,
    });

    await expect(verifier.verify(request)).resolves.toBe(true);
  });

  it("rejects a tampered signature", async () => {
    const verifier = new SlackWebhookVerifier("signing-secret", () => 1_710_756_000_000);
    const request = new Request("https://example.test/api/slack/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": "1710756000",
        "x-slack-signature": "v0=deadbeef",
      },
      body: JSON.stringify({ type: "event_callback" }),
    });

    await expect(verifier.verify(request)).resolves.toBe(false);
  });

  it("rejects stale requests", async () => {
    const verifier = new SlackWebhookVerifier("signing-secret", () => 1_710_756_600_000);
    const body = JSON.stringify({ type: "event_callback" });
    const timestamp = "1710756000";
    const signature = verifier.sign(timestamp, body);

    const request = new Request("https://example.test/api/slack/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body,
    });

    await expect(verifier.verify(request)).resolves.toBe(false);
  });
});
