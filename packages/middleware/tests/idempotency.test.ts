import { describe, expect, it } from "bun:test";
import { IdempotencyStore } from "../src/idempotency";

describe("IdempotencyStore", () => {
  it("returns false for the first observation and true for duplicates within TTL", () => {
    const store = new IdempotencyStore(1_000);

    expect(store.isDuplicate("slack:1", 100)).toBe(false);
    expect(store.isDuplicate("slack:1", 150)).toBe(true);
  });

  it("expires keys after TTL and allows them again", () => {
    const store = new IdempotencyStore(100);

    expect(store.isDuplicate("discord:1", 1_000)).toBe(false);
    expect(store.isDuplicate("discord:1", 1_050)).toBe(true);
    expect(store.isDuplicate("discord:1", 1_100)).toBe(false);
  });

  it("cleans up expired keys while preserving active ones", () => {
    const store = new IdempotencyStore(100);

    expect(store.isDuplicate("key-a", 0)).toBe(false);
    expect(store.isDuplicate("key-b", 50)).toBe(false);
    expect(store.isDuplicate("key-a", 100)).toBe(false);
    expect(store.isDuplicate("key-b", 120)).toBe(true);
  });
});
