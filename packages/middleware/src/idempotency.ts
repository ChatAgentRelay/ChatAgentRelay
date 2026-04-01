export class IdempotencyStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 300_000) {}

  isDuplicate(key: string, now = Date.now()): boolean {
    this.cleanup(now);
    if (this.seen.has(key)) return true;
    this.seen.set(key, now + this.ttlMs);
    return false;
  }

  private cleanup(now: number): void {
    for (const [key, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}
