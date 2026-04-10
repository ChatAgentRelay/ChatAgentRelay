import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { WebChatIngress } from "../src/canonicalize";
import type { SessionStore, WebChatResponse } from "../src/http-transport";
import { startWebChatServer } from "../src/http-transport";
import type { WebChatPipelineResult, WebChatStreamEvent } from "../src/types";

type BunServer = Server<unknown>;

const validMessage = {
  client_message_id: "msg_001",
  text: "Hello, world!",
  user_id: "user_1",
  display_name: "Test User",
  tenant_id: "t1",
  workspace_id: "ws1",
  channel_instance_id: "web_ch_1",
};

describe("WebChat HTTP transport", () => {
  let server: BunServer;
  let sessionStore: SessionStore;
  let ingress: WebChatIngress;
  let baseUrl: string;

  beforeAll(async () => {
    ingress = await WebChatIngress.create();
    const result = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => ({
        reply: "Hello from the agent!",
        conversationId: "conv_123",
        correlationId: "corr_456",
        sessionHandle: "sess_handle_1",
      }),
    });
    server = result.server;
    sessionStore = result.sessionStore;
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

  it("POST /api/chat returns agent reply with session info", async () => {
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
    expect(body.session_handle).toBe("sess_handle_1");
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
    const errorResult = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => {
        throw new Error("Backend timeout");
      },
    });

    try {
      const res = await fetch(`http://localhost:${errorResult.server.port}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validMessage),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as WebChatResponse;
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Backend timeout");
    } finally {
      errorResult.server.stop(true);
    }
  });
});

describe("WebChat slash commands", () => {
  let server: BunServer;
  let sessionStore: SessionStore;
  let baseUrl: string;

  beforeAll(async () => {
    const ingress = await WebChatIngress.create();
    const result = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => ({ reply: "ok", conversationId: "c", correlationId: "r" }),
    });
    server = result.server;
    sessionStore = result.sessionStore;
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("/help returns command list", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validMessage, text: "/help" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("/help");
    expect(body.reply).toContain("/status");
    expect(body.reply).toContain("/clear");
  });

  it("/status returns session count", async () => {
    sessionStore.set("c1", "sh1");
    sessionStore.set("c2", "sh2");

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validMessage, text: "/status" }),
    });
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("2");

    sessionStore.clear();
  });

  it("/clear removes session", async () => {
    sessionStore.set("conv_xyz", "sh_abc");
    expect(sessionStore.get("conv_xyz")).toBe("sh_abc");

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validMessage, text: "/clear", conversation_id: "conv_xyz" }),
    });
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("cleared");

    expect(sessionStore.get("conv_xyz")).toBeUndefined();
  });

  it("unknown /command is treated as normal message", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validMessage, text: "/unknown command" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(true);
    expect(body.reply).toBe("ok");
  });
});

describe("WebChat SSE streaming", () => {
  let server: BunServer;
  let baseUrl: string;

  beforeAll(async () => {
    const ingress = await WebChatIngress.create();
    const result = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => ({ reply: "sync", conversationId: "c", correlationId: "r" }),
      streamingPipelineFn: async (raw, onEvent) => {
        onEvent({ type: "status", status: "working" });
        onEvent({ type: "text_delta", content: "Hello" });
        onEvent({ type: "text_delta", content: " World" });
        return {
          reply: "Hello World",
          conversationId: "conv_stream",
          correlationId: "corr_stream",
          sessionHandle: "sess_stream",
        };
      },
    });
    server = result.server;
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("POST /api/chat/stream returns SSE events", async () => {
    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validMessage),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const text = await res.text();
    const events = text
      .split("\n\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.replace("data: ", "")) as WebChatStreamEvent);

    const hasStatus = events.some((e) => e.type === "status");
    const deltas = events.filter((e) => e.type === "text_delta");
    const done = events.find((e) => e.type === "done");

    expect(hasStatus).toBe(true);
    expect(deltas.length).toBe(2);
    expect(done).toBeDefined();
    if (done && done.type === "done") {
      expect(done.reply).toBe("Hello World");
      expect(done.session_handle).toBe("sess_stream");
    }
  });

  it("returns 501 when streaming not configured", async () => {
    const ingress = await WebChatIngress.create();
    const noStreamResult = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => ({ reply: "x", conversationId: "c", correlationId: "r" }),
    });
    try {
      const res = await fetch(`http://localhost:${noStreamResult.server.port}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validMessage),
      });
      expect(res.status).toBe(501);
    } finally {
      noStreamResult.server.stop(true);
    }
  });
});

describe("WebChat HITL resume", () => {
  let server: BunServer;
  let baseUrl: string;

  beforeAll(async () => {
    const ingress = await WebChatIngress.create();
    const result = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => ({
        reply: "Please confirm",
        conversationId: "conv_hitl",
        correlationId: "corr_hitl",
        sessionHandle: "sess_hitl_1",
        hitlPending: true,
        hitlPrompt: "Approve the action?",
      }),
      resumeFn: async (sessionHandle, text) => ({
        reply: `Resumed with: ${text}`,
        conversationId: "conv_hitl",
        correlationId: "corr_resume",
        sessionHandle,
      }),
      resumeStreamingFn: async (sessionHandle, text, onEvent) => {
        onEvent({ type: "status", status: "working" });
        onEvent({ type: "text_delta", content: `Resumed: ${text}` });
        return {
          reply: `Resumed: ${text}`,
          conversationId: "conv_hitl",
          correlationId: "corr_resume_s",
          sessionHandle,
        };
      },
    });
    server = result.server;
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("initial request returns hitl_pending", async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validMessage),
    });
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(true);
    expect(body.hitl_pending).toBe(true);
    expect(body.hitl_prompt).toBe("Approve the action?");
    expect(body.session_handle).toBe("sess_hitl_1");
  });

  it("POST /api/chat/resume returns resumed reply", async () => {
    const res = await fetch(`${baseUrl}/api/chat/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_handle: "sess_hitl_1", text: "yes" }),
    });
    const body = (await res.json()) as WebChatResponse;
    expect(body.ok).toBe(true);
    expect(body.reply).toBe("Resumed with: yes");
    expect(body.session_handle).toBe("sess_hitl_1");
  });

  it("POST /api/chat/resume requires session_handle and text", async () => {
    const res = await fetch(`${baseUrl}/api/chat/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "yes" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/chat/resume/stream returns SSE events", async () => {
    const res = await fetch(`${baseUrl}/api/chat/resume/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_handle: "sess_hitl_1", text: "approved" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const text = await res.text();
    const events = text
      .split("\n\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.replace("data: ", "")) as WebChatStreamEvent);

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done && done.type === "done") {
      expect(done.reply).toContain("approved");
    }
  });
});

describe("WebChat session management", () => {
  let server: BunServer;
  let sessionStore: SessionStore;
  let baseUrl: string;

  beforeAll(async () => {
    const ingress = await WebChatIngress.create();
    const result = startWebChatServer({
      port: 0,
      ingress,
      pipelineFn: async () => ({
        reply: "ok",
        conversationId: "conv_sess",
        correlationId: "corr_sess",
        sessionHandle: "sess_auto",
      }),
    });
    server = result.server;
    sessionStore = result.sessionStore;
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it("stores session after pipeline execution", async () => {
    await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validMessage),
    });

    expect(sessionStore.get("conv_sess")).toBe("sess_auto");
  });

  it("GET /api/chat/sessions/:id returns session info", async () => {
    sessionStore.set("conv_info", "sh_info");
    const res = await fetch(`${baseUrl}/api/chat/sessions/conv_info`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["session_handle"]).toBe("sh_info");
  });

  it("GET /api/chat/sessions/:id returns 404 for unknown", async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions/unknown_conv`);
    expect(res.status).toBe(404);
  });
});
