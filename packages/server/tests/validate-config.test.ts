import { describe, expect, it } from "bun:test";
import { formatConfigErrors } from "../src/validate-config";

describe("formatConfigErrors", () => {
  it("formats errors with hints", () => {
    const output = formatConfigErrors([
      {
        field: "TEST_FIELD",
        message: "test error",
        hint: "test hint",
      },
    ]);
    expect(output).toContain("TEST_FIELD");
    expect(output).toContain("test error");
    expect(output).toContain("test hint");
    expect(output).toContain("getting-started.md");
  });

  it("returns empty string for no errors", () => {
    expect(formatConfigErrors([])).toBe("");
  });

  it("formats multiple errors", () => {
    const output = formatConfigErrors([
      { field: "A", message: "error A" },
      { field: "B", message: "error B", hint: "hint B" },
    ]);
    expect(output).toContain("[A]");
    expect(output).toContain("[B]");
    expect(output).toContain("hint B");
  });
});
