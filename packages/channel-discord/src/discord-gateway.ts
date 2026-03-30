import type {
  DiscordGatewayPayload,
  DiscordInteraction,
  DiscordMessageDeleteEvent,
  DiscordMessageEvent,
  DiscordMessageUpdateEvent,
  DiscordReactionEvent,
} from "./types";

const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_BASE_DELAY_MS = 1000;

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

export const DEFAULT_INTENTS = 33281;

export type DiscordGatewayConfig = {
  token: string;
  intents: number;
  onMessage: (event: DiscordMessageEvent) => void | Promise<void>;
  onInteraction?: ((interaction: DiscordInteraction) => void | Promise<void>) | undefined;
  onMessageUpdate?: ((event: DiscordMessageUpdateEvent) => void | Promise<void>) | undefined;
  onMessageDelete?: ((event: DiscordMessageDeleteEvent) => void | Promise<void>) | undefined;
  onReaction?: ((event: DiscordReactionEvent) => void | Promise<void>) | undefined;
  onError?: ((error: Error) => void) | undefined;
  onReconnect?: ((attempt: number) => void) | undefined;
  maxReconnectAttempts?: number | undefined;
};

export class DiscordGatewayConnection {
  private ws: WebSocket | null = null;
  private readonly config: DiscordGatewayConfig;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sequenceNumber: number | null = null;
  private heartbeatAcked = true;

  constructor(config: DiscordGatewayConfig) {
    this.config = config;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    await this.connectInternal();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private async connectInternal(): Promise<void> {
    this.ws = new WebSocket(DISCORD_GATEWAY_URL);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("WebSocket not initialized"));

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (msgEvent) => {
        try {
          const payload = JSON.parse(String(msgEvent.data)) as DiscordGatewayPayload;
          this.handlePayload(payload, resolve);
        } catch (error) {
          this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      };

      this.ws.onerror = (event) => {
        this.config.onError?.(new Error(`WebSocket error: ${String(event)}`));
        reject(new Error("WebSocket connection failed"));
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        if (this.shouldReconnect) {
          void this.scheduleReconnect();
        }
      };
    });
  }

  private handlePayload(payload: DiscordGatewayPayload, resolveConnect?: (value: void) => void): void {
    if (payload.s !== null) {
      this.sequenceNumber = payload.s;
    }

    switch (payload.op) {
      case OP_HELLO:
        this.handleHello(payload.d as { heartbeat_interval: number });
        resolveConnect?.();
        break;

      case OP_HEARTBEAT_ACK:
        this.heartbeatAcked = true;
        break;

      case OP_DISPATCH:
        if (payload.t === "MESSAGE_CREATE") {
          void this.config.onMessage(payload.d as DiscordMessageEvent);
        } else if (payload.t === "INTERACTION_CREATE" && this.config.onInteraction) {
          void this.config.onInteraction(payload.d as DiscordInteraction);
        } else if (payload.t === "MESSAGE_UPDATE" && this.config.onMessageUpdate) {
          void this.config.onMessageUpdate(payload.d as DiscordMessageUpdateEvent);
        } else if (payload.t === "MESSAGE_DELETE" && this.config.onMessageDelete) {
          void this.config.onMessageDelete(payload.d as DiscordMessageDeleteEvent);
        } else if (payload.t === "MESSAGE_REACTION_ADD" && this.config.onReaction) {
          void this.config.onReaction(payload.d as DiscordReactionEvent);
        }
        break;

      case OP_RECONNECT:
        this.ws?.close();
        break;

      case OP_INVALID_SESSION:
        this.sequenceNumber = null;
        this.ws?.close();
        break;
    }
  }

  private handleHello(data: { heartbeat_interval: number }): void {
    this.startHeartbeat(data.heartbeat_interval);
    this.sendIdentify();
  }

  private sendIdentify(): void {
    const identifyPayload = {
      op: OP_IDENTIFY,
      d: {
        token: this.config.token,
        intents: this.config.intents,
        properties: {
          os: "linux",
          browser: "chat-agent-relay",
          device: "chat-agent-relay",
        },
      },
    };
    this.ws?.send(JSON.stringify(identifyPayload));
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;

    const jitter = Math.random();
    setTimeout(() => {
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (!this.heartbeatAcked) {
          this.config.onError?.(new Error("Heartbeat not acknowledged, reconnecting"));
          this.ws?.close();
          return;
        }
        this.sendHeartbeat();
      }, intervalMs);
    }, intervalMs * jitter);
  }

  private sendHeartbeat(): void {
    this.heartbeatAcked = false;
    this.ws?.send(JSON.stringify({ op: OP_HEARTBEAT, d: this.sequenceNumber }));
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.config.onError?.(new Error(`Max reconnect attempts (${this.maxReconnectAttempts}) exceeded`));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(DEFAULT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1), 30000);
    this.config.onReconnect?.(this.reconnectAttempts);

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (!this.shouldReconnect) return;

    try {
      await this.connectInternal();
    } catch (error) {
      this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
      if (this.shouldReconnect) {
        void this.scheduleReconnect();
      }
    }
  }
}
