import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { DiscordGatewayConnection, DEFAULT_INTENTS } from "../src/discord-gateway";
import type { DiscordMessageEvent, DiscordGatewayPayload } from "../src/types";

function createMockGatewayServer(options?: {
  heartbeatInterval?: number;
  sendMessageCreate?: boolean;
}): { server: Server<undefined>; port: number; getConnections: () => number } {
  let connectionCount = 0;
  const heartbeatInterval = options?.heartbeatInterval ?? 45000;
  const sendMessageCreate = options?.sendMessageCreate ?? false;

  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not a WebSocket request", { status: 400 });
    },
    websocket: {
      open(ws) {
        connectionCount++;
        const hello: DiscordGatewayPayload = {
          op: 10,
          d: { heartbeat_interval: heartbeatInterval },
          s: null,
          t: null,
        };
        ws.send(JSON.stringify(hello));
      },
      message(ws, msg) {
        const payload = JSON.parse(String(msg)) as DiscordGatewayPayload;

        if (payload.op === 1) {
          ws.send(JSON.stringify({ op: 11, d: null, s: null, t: null }));
        }

        if (payload.op === 2 && sendMessageCreate) {
          const messageEvent: DiscordGatewayPayload = {
            op: 0,
            d: {
              id: "1234567890123456789",
              channel_id: "9876543210987654321",
              guild_id: "5555666677778888990",
              author: { id: "111122223333444455", username: "testuser", bot: false },
              content: "Test message via gateway",
              timestamp: "2024-03-18T12:00:00.000000+00:00",
            } satisfies DiscordMessageEvent,
            s: 1,
            t: "MESSAGE_CREATE",
          };
          ws.send(JSON.stringify(messageEvent));
        }
      },
      close() {},
    },
  });

  return {
    server,
    port: server.port!,
    getConnections: () => connectionCount,
  };
}

describe("Discord gateway connection", () => {
  let mockGateway: ReturnType<typeof createMockGatewayServer>;

  afterAll(() => {
    mockGateway?.server.stop(true);
  });

  it("parses heartbeat_interval from Hello and connects", async () => {
    mockGateway = createMockGatewayServer({ heartbeatInterval: 41250 });

    let connected = false;
    const gateway = new DiscordGatewayConnection({
      token: "test-token",
      intents: DEFAULT_INTENTS,
      onMessage: () => {},
    });

    const originalWS = globalThis.WebSocket;
    const MockWS = class extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const newUrl = String(url).replace("wss://gateway.discord.gg", `ws://localhost:${mockGateway.port}`);
        super(newUrl, protocols);
      }
    };
    globalThis.WebSocket = MockWS as typeof WebSocket;

    try {
      await gateway.connect();
      connected = true;
      expect(connected).toBe(true);
      expect(mockGateway.getConnections()).toBe(1);
    } finally {
      gateway.disconnect();
      globalThis.WebSocket = originalWS;
    }
  });

  it("dispatches MESSAGE_CREATE events via onMessage", async () => {
    mockGateway = createMockGatewayServer({ sendMessageCreate: true });

    const received: DiscordMessageEvent[] = [];

    const gateway = new DiscordGatewayConnection({
      token: "test-token",
      intents: DEFAULT_INTENTS,
      onMessage: (event) => {
        received.push(event);
      },
    });

    const originalWS = globalThis.WebSocket;
    const MockWS = class extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const newUrl = String(url).replace("wss://gateway.discord.gg", `ws://localhost:${mockGateway.port}`);
        super(newUrl, protocols);
      }
    };
    globalThis.WebSocket = MockWS as typeof WebSocket;

    try {
      await gateway.connect();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received[0]!.content).toBe("Test message via gateway");
      expect(received[0]!.author.username).toBe("testuser");
    } finally {
      gateway.disconnect();
      globalThis.WebSocket = originalWS;
    }
  });

  it("tracks reconnection attempts", async () => {
    const reconnectAttempts: number[] = [];

    const gateway = new DiscordGatewayConnection({
      token: "test-token",
      intents: DEFAULT_INTENTS,
      onMessage: () => {},
      onReconnect: (attempt) => {
        reconnectAttempts.push(attempt);
      },
      maxReconnectAttempts: 2,
    });

    const originalWS = globalThis.WebSocket;
    let callCount = 0;
    const MockWS = class extends WebSocket {
      constructor(_url: string | URL, _protocols?: string | string[]) {
        callCount++;
        super(`ws://localhost:1`, _protocols);
      }
    };
    globalThis.WebSocket = MockWS as typeof WebSocket;

    try {
      await expect(gateway.connect()).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 3500));
      expect(reconnectAttempts.length).toBeGreaterThanOrEqual(1);
      expect(reconnectAttempts[0]).toBe(1);
    } finally {
      gateway.disconnect();
      globalThis.WebSocket = originalWS;
    }
  });

  it("exports DEFAULT_INTENTS as 33281", () => {
    expect(DEFAULT_INTENTS).toBe(33281);
  });
});
