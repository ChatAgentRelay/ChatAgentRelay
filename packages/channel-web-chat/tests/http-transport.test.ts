import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { WebChatIngress } from "../src/canonicalize";
import { startWebChatServer } from "../src/http-transport";
import type { WebChatResponse } from "../src/http-transport";

type BunServer = Server<unknown>;

describe("WebChat HTTP transport", () => {
  let server: BunServer;
  let ingress: WebChatIngress;
  let baseUrl: string;

  const validMessage = {
    client_message_id: "msg_001",
    text: "Hello, world!",
    user_id: "user_1",
    display_name: "Test User",
    tenant_id: "t1",
    workspace_id: "ws1",
    channel_instance_id: "web_ch_1",
  };

  beforeAll(async () => {
    ingress = await WebChatIngress.create();
    server = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => ({
        reply: "Hello from the agent!",
        conversationId: "conv_123",
        correlationId: "corr_456",
      }),
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("GET /api/health returns ok", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
  });

  it("POST /api/chat returns agent reply", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validMessage),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(true);
    expect(body.reply).toBe("Hello from the agent!");
    expect(body.conversation_id).toBe("conv_123");
    expect(body.correlation_id).toBe("corr_456");
  });

  it("POST /api/chat with invalid body returns 400", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Invalid JSON");
  });

  it("POST /api/chat with missing fields returns 400", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(false);
  });

  it("OPTIONS returns CORS headers", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });

  it("handles pipeline errors gracefully", async () => {
    const errorServer = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => { throw new Error("Backend timeout"); },
    });

    try {
      const res = await fetch(`http://localhost:${errorServer.port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validMessage),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as WebChatResponse;
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Backend timeout");
    } finally {
      errorServer.stop(true);
    }
  });
});
