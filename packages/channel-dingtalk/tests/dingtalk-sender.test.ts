import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { Server } from "bun";
import { createDingTalkSender } from "../src/dingtalk-sender";

type BunServer = Server<unknown>;

function makeSendEvent(sessionWebhook: string): CanonicalEvent {
  return {
    event_id: "evt_test",
    schema_version: "v1alpha1",
    event_type: "message.send.requested",
    tenant_id: "t",
    workspace_id: "w",
    channel: "dingtalk",
    conversation_id: "dt-conv",
    session_id: "dt-conv",
    correlation_id: "corr_test",
    occurred_at: new Date().toISOString(),
    actor_type: "system",
    payload: { text: "Hello back!" },
    provider_extensions: {
      dingtalk: { session_webhook: sessionWebhook },
    },
  };
}

describe("DingTalk sender", () => {
  let server: BunServer;
  let lastBody: unknown;
  let responseCode: number;
  let responseBody: unknown;

  beforeAll(() => {
    responseCode = 200;
    responseBody = { errcode: 0, errmsg: "ok" };
    server = Bun.serve({
      port: 0,
      fetch(req) {
        return req.json().then((body) => {
          lastBody = body;
          return new Response(JSON.stringify(responseBody), {
            status: responseCode,
            headers: { "Content-Type": "application/json" },
          });
        });
      },
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  it("sendViaWebhook sends correctly formatted payload", async () => {
    const sender = createDingTalkSender();
    await sender.sendViaWebhook(`http://localhost:${server.port}/webhook`, "Test message");
    expect(lastBody).toEqual({ msgtype: "text", text: { content: "Test message" } });
  });

  it("sendViaWebhook throws on non-200 response", async () => {
    responseCode = 500;
    responseBody = {};
    const sender = createDingTalkSender();
    await expect(
      sender.sendViaWebhook(`http://localhost:${server.port}/webhook`, "Test"),
    ).rejects.toThrow("webhook request failed");
    responseCode = 200;
    responseBody = { errcode: 0, errmsg: "ok" };
  });

  it("sendViaWebhook throws on DingTalk API error", async () => {
    responseBody = { errcode: 310000, errmsg: "token expired" };
    const sender = createDingTalkSender();
    await expect(
      sender.sendViaWebhook(`http://localhost:${server.port}/webhook`, "Test"),
    ).rejects.toThrow("DingTalk API error 310000");
    responseBody = { errcode: 0, errmsg: "ok" };
  });

  it("sendFn extracts sessionWebhook from provider_extensions and sends", async () => {
    const sender = createDingTalkSender();
    const event = makeSendEvent(`http://localhost:${server.port}/session`);
    await sender.sendFn(event);
    expect(lastBody).toEqual({ msgtype: "text", text: { content: "Hello back!" } });
  });

  it("sendFn throws when session_webhook is missing", async () => {
    const sender = createDingTalkSender();
    const event = makeSendEvent("");
    (event.provider_extensions as Record<string, unknown>)["dingtalk"] = {};
    await expect(sender.sendFn(event)).rejects.toThrow("no session_webhook");
  });

  it("sendFn throws when payload text is missing", async () => {
    const sender = createDingTalkSender();
    const event = makeSendEvent(`http://localhost:${server.port}/session`);
    event.payload = {};
    await expect(sender.sendFn(event)).rejects.toThrow("missing text");
  });
});
