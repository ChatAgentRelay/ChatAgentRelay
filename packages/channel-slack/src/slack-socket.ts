import type { SlackSocketEvent } from "./types";

const SLACK_API_BASE = "https://slack.com/api";
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_BASE_DELAY_MS = 1000;

export type SlackSocketConfig = {
  appToken: string;
  onMessage: (event: SlackSocketEvent) => void | Promise<void>;
  onError?: ((error: Error) => void) | undefined;
  onReconnect?: ((attempt: number) => void) | undefined;
  maxReconnectAttempts?: number | undefined;
};

export class SlackSocketConnection {
  private ws: WebSocket | null = null;
  private readonly config: SlackSocketConfig;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;

  constructor(config: SlackSocketConfig) {
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
    this.ws?.close();
    this.ws = null;
  }

  private async connectInternal(): Promise<void> {
    const url = await this.getWebSocketUrl();
    this.ws = new WebSocket(url);

    this.ws.onmessage = (msgEvent) => {
      try {
        const data = JSON.parse(String(msgEvent.data)) as Record<string, unknown>;

        if (data["type"] === "events_api") {
          const socketEvent = data as unknown as SlackSocketEvent;
          this.ws?.send(JSON.stringify({ envelope_id: socketEvent.envelope_id }));
          void this.config.onMessage(socketEvent);
        }
      } catch (error) {
        this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };

    this.ws.onerror = (event) => {
      this.config.onError?.(new Error(`WebSocket error: ${String(event)}`));
    };

    this.ws.onclose = () => {
      if (this.shouldReconnect) {
        void this.scheduleReconnect();
      }
    };

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("WebSocket not initialized"));
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        resolve();
      };
      this.ws.onerror = () => reject(new Error("WebSocket connection failed"));
    });
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

  private async getWebSocketUrl(): Promise<string> {
    const response = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${this.config.appToken}`,
      },
    });

    const body = (await response.json()) as { ok: boolean; url?: string; error?: string };
    if (!body.ok || !body.url) {
      throw new Error(`Failed to open Slack Socket Mode connection: ${body.error ?? "no url returned"}`);
    }

    return body.url;
  }
}
