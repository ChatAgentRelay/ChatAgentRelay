import { describe, it, expect, beforeAll } from "bun:test";
import { ContractHarnessValidators } from "@cap/contract-harness";
import type { CanonicalizationResult } from "@cap/channel-web-chat";

export type ChannelIngressUnderTest = {
  canonicalize(raw: unknown): CanonicalizationResult;
};

export type ChannelConformanceConfig = {
  name: string;
  ingress: ChannelIngressUnderTest;
  validInput: unknown;
  invalidInputs: Array<{ label: string; input: unknown; expectedCode: string }>;
  expectedChannel: string;
};

export function testChannelIngress(config: ChannelConformanceConfig): void {
  describe(`channel ingress conformance: ${config.name}`, () => {
    let validators: ContractHarnessValidators;

    beforeAll(async () => {
      validators = await ContractHarnessValidators.create();
    });

    it("accepts unknown input without throwing", () => {
      expect(() => config.ingress.canonicalize(config.validInput)).not.toThrow();
    });

    it("returns CanonicalizationResult (not thrown error) for valid input", () => {
      const result = config.ingress.canonicalize(config.validInput);
      expect(result).toHaveProperty("ok");
    });

    it("produces schema-valid message.received on success", () => {
      const result = config.ingress.canonicalize(config.validInput);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.event.event_type).toBe("message.received");

      const v = validators.validateEvent(result.event);
      expect(v.ok).toBe(true);
    });

    it("returns a stable idempotencyKey", () => {
      const r1 = config.ingress.canonicalize(config.validInput);
      const r2 = config.ingress.canonicalize(config.validInput);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;
      expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
      expect(r1.idempotencyKey.length).toBeGreaterThan(0);
    });

    it("sets correct channel type", () => {
      const result = config.ingress.canonicalize(config.validInput);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.event.channel).toBe(config.expectedChannel);
    });

    it("includes all required canonical fields", () => {
      const result = config.ingress.canonicalize(config.validInput);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const event = result.event;
      expect(event.event_id).toBeDefined();
      expect(event.schema_version).toBe("v1alpha1");
      expect(event.tenant_id).toBeDefined();
      expect(event.workspace_id).toBeDefined();
      expect(event.conversation_id).toBeDefined();
      expect(event.session_id).toBeDefined();
      expect(event.correlation_id).toBeDefined();
      expect(event.occurred_at).toBeDefined();
      expect(event.actor_type).toBe("end_user");
      expect(typeof event.payload["text"]).toBe("string");
    });

    it("does not throw for null input", () => {
      expect(() => config.ingress.canonicalize(null)).not.toThrow();
      const result = config.ingress.canonicalize(null);
      expect(result.ok).toBe(false);
    });

    it("does not throw for undefined input", () => {
      expect(() => config.ingress.canonicalize(undefined)).not.toThrow();
      const result = config.ingress.canonicalize(undefined);
      expect(result.ok).toBe(false);
    });

    for (const { label, input, expectedCode } of config.invalidInputs) {
      it(`rejects invalid input: ${label}`, () => {
        const result = config.ingress.canonicalize(input);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe(expectedCode);
        expect(result.error.message.length).toBeGreaterThan(0);
      });
    }
  });
}
