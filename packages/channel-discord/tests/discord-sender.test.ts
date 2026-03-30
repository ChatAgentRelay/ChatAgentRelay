import { afterAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { DiscordSender } from "../src/discord-sender";

type BunServer = Server<unknown>;

const DISCORD_API_BASE = "https://discord.com/api/v10";

function patchFetch(port: number): () => void {
  const originalFetch = globalThis.fetch;
  const patched = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input).replace(
      DISCORD_API_BASE,
      `http://localhost:${port}`,
    );
    return originalFetch(url, init);
  };
  patched.preconnect = originalFetch.preconnect;
  globalThis.fetch = patched as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("Discord sender", () => {
  let mockServer: BunServer;
  let mockPort: number;

  afterAll(() => {
    if (mockServer) mockServer.stop(true);
  });

  it("sends a message and returns providerMessageId", async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        expect(req.headers.get("Authorization")).toBe("Bot test-bot-token");
        expect(req.method).toBe("POST");
        const body = (await req.json()) as Record<string, unknown>;
        expect(body["content"]).toBe("Hello from CAR!");
        return Response.json({ id: "9999888877776666555", channel_id: "1234", content: "Hello from CAR!" });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const restore = patchFetch(mockPort);
    try {
      const result = await sender.send("1234567890", "Hello from CAR!");
      expect(result.providerMessageId).toBe("9999888877776666555");
    } finally {
      restore();
    }
  });

  it("sends a message with reply reference", async () => {
    let capturedBody: Record<string, unknown> = {};
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ id: "1111222233334444555", channel_id: "1234", content: "reply" });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const restore = patchFetch(mockPort);
    try {
      await sender.send("1234567890", "This is a reply", "9876543210987654321");
      const ref = capturedBody["message_reference"] as Record<string, string>;
      expect(ref["message_id"]).toBe("9876543210987654321");
    } finally {
      restore();
    }
  });

  it("throws on API error", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ message: "Unknown Channel", code: 10003 }), { status: 404 });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const restore = patchFetch(mockPort);
    try {
      await expect(sender.send("INVALID", "Hello")).rejects.toThrow("Discord send message failed (404)");
    } finally {
      restore();
    }
  });

  it("chunks messages longer than 2000 characters", async () => {
    const receivedMessages: string[] = [];
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        receivedMessages.push(body["content"] as string);
        return Response.json({ id: `msg_${receivedMessages.length}`, channel_id: "1234", content: body["content"] });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const longText = "A".repeat(3500);
    const restore = patchFetch(mockPort);
    try {
      const result = await sender.send("1234567890", longText);
      expect(receivedMessages.length).toBe(2);
      expect(receivedMessages[0]!.length).toBeLessThanOrEqual(2000);
      expect(receivedMessages[1]!.length).toBeGreaterThan(0);
      expect(result.providerMessageId).toBe("msg_2");
    } finally {
      restore();
    }
  });

  it("creates a sendFn bound to a channel", async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ id: "5555666677778888999", channel_id: "C123", content: "hi" });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const restore = patchFetch(mockPort);
    try {
      const sendFn = sender.createSendFn("C123");
      const result = await sendFn("Hello");
      expect(result.providerMessageId).toBe("5555666677778888999");
    } finally {
      restore();
    }
  });

  it("updates a message via PATCH", async () => {
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> = {};
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedMethod = req.method;
        capturedBody = (await req.json()) as Record<string, unknown>;
        return new Response(null, { status: 200 });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const restore = patchFetch(mockPort);
    try {
      await sender.update("1234567890", "9876543210", "Updated content");
      expect(capturedMethod).toBe("PATCH");
      expect(capturedBody["content"]).toBe("Updated content");
    } finally {
      restore();
    }
  });

  it("adds a reaction via PUT", async () => {
    let capturedMethod = "";
    let capturedUrl = "";
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        capturedMethod = req.method;
        capturedUrl = new URL(req.url).pathname;
        return new Response(null, { status: 204 });
      },
    });
    mockPort = mockServer.port!;

    const sender = new DiscordSender({ token: "test-bot-token" });
    const restore = patchFetch(mockPort);
    try {
      await sender.addReaction("1234567890", "9876543210", "👍");
      expect(capturedMethod).toBe("PUT");
      expect(capturedUrl).toContain("/reactions/");
      expect(capturedUrl).toContain("/@me");
    } finally {
      restore();
    }
  });
});
