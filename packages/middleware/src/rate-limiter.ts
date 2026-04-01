export type RateLimitScope = "sender" | "conversation" | "tenant";

export type RateLimitConfig = {
  maxPerMinute: number;
  scope: RateLimitScope;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs?: number | undefined;
};

const WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly config: RateLimitConfig) {}

  get scope(): RateLimitScope {
    return this.config.scope;
  }

  check(key: string): RateLimitDecision {
    const now = Date.now();
    const entries = this.windows.get(key) ?? [];
    const recent = entries.filter((timestamp) => now - timestamp < WINDOW_MS);

    if (recent.length >= this.config.maxPerMinute) {
      const oldestInWindow = recent[0]!;
      return {
        allowed: false,
        retryAfterMs: WINDOW_MS - (now - oldestInWindow),
      };
    }

    recent.push(now);
    this.windows.set(key, recent);
    return { allowed: true };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entries] of this.windows) {
      const recent = entries.filter((timestamp) => now - timestamp < WINDOW_MS);
      if (recent.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, recent);
      }
    }
  }
}
