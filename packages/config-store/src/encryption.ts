const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const TAG_LENGTH = 128;
const PREFIX = "enc:";

export class EncryptionEngine {
  private key: CryptoKey | null = null;
  private rawKey: string;

  constructor(masterKey: string) {
    this.rawKey = masterKey;
  }

  private async getKey(): Promise<CryptoKey> {
    if (this.key) return this.key;
    const keyData = new TextEncoder().encode(this.rawKey.padEnd(32, "0").slice(0, 32));
    this.key = await crypto.subtle.importKey("raw", keyData, { name: ALGORITHM }, false, [
      "encrypt",
      "decrypt",
    ]);
    return this.key;
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
      key,
      encoded,
    );
    const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), IV_LENGTH);
    return PREFIX + btoa(String.fromCharCode(...combined));
  }

  async decrypt(encrypted: string): Promise<string> {
    if (!encrypted.startsWith(PREFIX)) return encrypted;
    const key = await this.getKey();
    const raw = atob(encrypted.slice(PREFIX.length));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const iv = bytes.slice(0, IV_LENGTH);
    const ciphertext = bytes.slice(IV_LENGTH);
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
        key,
        ciphertext,
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new Error(
        "Decryption failed — CAR_ENCRYPTION_KEY does not match the key used to encrypt this data. " +
        "If the key has changed or the database was created with a different key, either restore the " +
        "original key or delete the database and re-register channels/agents.",
      );
    }
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  async encryptFields(
    obj: Record<string, unknown>,
    fields: string[],
  ): Promise<Record<string, unknown>> {
    const result = { ...obj };
    for (const field of fields) {
      const val = result[field];
      if (typeof val === "string" && val && !this.isEncrypted(val)) {
        result[field] = await this.encrypt(val);
      }
    }
    return result;
  }

  async decryptFields(
    obj: Record<string, unknown>,
    fields: string[],
  ): Promise<Record<string, unknown>> {
    const result = { ...obj };
    for (const field of fields) {
      const val = result[field];
      if (typeof val === "string" && this.isEncrypted(val)) {
        result[field] = await this.decrypt(val);
      }
    }
    return result;
  }
}
