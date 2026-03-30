import { describe, expect, it } from "bun:test";
import { EncryptionEngine } from "../src/encryption";

describe("EncryptionEngine", () => {
  it("encrypts and decrypts a string", async () => {
    const engine = new EncryptionEngine("test-key-for-encryption-1234");
    const encrypted = await engine.encrypt("hello world");
    expect(encrypted).toStartWith("enc:");
    expect(encrypted).not.toContain("hello world");
    const decrypted = await engine.decrypt(encrypted);
    expect(decrypted).toBe("hello world");
  });

  it("returns plaintext if not encrypted", async () => {
    const engine = new EncryptionEngine("test-key");
    const result = await engine.decrypt("plain text");
    expect(result).toBe("plain text");
  });

  it("isEncrypted detects encrypted values", async () => {
    const engine = new EncryptionEngine("test-key");
    const encrypted = await engine.encrypt("secret");
    expect(engine.isEncrypted(encrypted)).toBe(true);
    expect(engine.isEncrypted("plain")).toBe(false);
  });

  it("different encryptions produce different ciphertexts (random IV)", async () => {
    const engine = new EncryptionEngine("test-key");
    const a = await engine.encrypt("same");
    const b = await engine.encrypt("same");
    expect(a).not.toBe(b);
    expect(await engine.decrypt(a)).toBe("same");
    expect(await engine.decrypt(b)).toBe("same");
  });

  it("encrypts/decrypts specific fields in an object", async () => {
    const engine = new EncryptionEngine("test-key-for-fields-12345");
    const obj = { apiKey: "sk-secret", endpoint: "http://localhost" };
    const encrypted = await engine.encryptFields(obj, ["apiKey"]);
    expect(engine.isEncrypted(encrypted["apiKey"] as string)).toBe(true);
    expect(encrypted["endpoint"]).toBe("http://localhost");
    const decrypted = await engine.decryptFields(encrypted, ["apiKey"]);
    expect(decrypted["apiKey"]).toBe("sk-secret");
  });

  it("skips empty strings during encryption", async () => {
    const engine = new EncryptionEngine("test-key");
    const obj = { apiKey: "", endpoint: "http://x" };
    const encrypted = await engine.encryptFields(obj, ["apiKey"]);
    expect(encrypted["apiKey"]).toBe("");
  });
});
