import { describe, expect, test } from "bun:test";
import * as EventLedger from "../src";

describe("event ledger scaffold", () => {
  test("loads the package entrypoint", () => {
    expect(typeof EventLedger).toBe("object");
  });
});
