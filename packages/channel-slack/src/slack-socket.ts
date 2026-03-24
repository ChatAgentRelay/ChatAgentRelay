import type { SlackSocketEvent } from "./types";

const SLACK_API_BASE = "https://slack.com/api";

export type SlackSocketConfig = {
  appToken: string;
  onMessage: (event: SlackSocketEvent) => void | Promise<void>;
  onError?: ((error: Error) => void) | undefined;
};

export class SlackSocketConnection {
  private ws: WebSocket | null = null;
  private readonly config: SlackSocketConfig;

  constructor(config: SlackSocketConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    const url = await this.getWebSocketUrl();
    this.ws = new WebSocket(url);

    this.ws.onmessage = (msgEvent) => {
      try {
        const data = JSON.parse(String(msgEvent.data)) as Record<string, unknown>;

        if (data["type"] === "events_api") {
          const socketEvent = data as unknown as SlackSocketEvent;

          // Acknowledge immediately
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

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("WebSocket not initialized"));
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("WebSocket connection failed"));
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  private async getWebSocketUrl(): Promise<string> {
    const response = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${this.config.appToken}`,
      },
    });

    const body = (await response.json()) as { ok: boolean; url?: string; error?: string };
    if (!body.ok || !body.url) {
      throw new Error(`Failed to open Slack Socket Mode connection: ${body.error ?? "no url returned"}`);
    }

    return body.url;
  }
}
