import { beforeAll, describe, expect, it } from "bun:test";
import type { ChannelAdapter } from "@chat-agent-relay/contract-harness";
import { ContractHarnessValidators } from "@chat-agent-relay/contract-harness";

export type ChannelAdapterUnderTest = ChannelAdapter;

export type ChannelConformanceConfig = {
  name: string;
  adapter: ChannelAdapterUnderTest;
  validInput: unknown;
  invalidInputs: Array<{ label: string; input: unknown; expectedCode: string }>;
  expectedChannel: string;
};

export function testChannelAdapter(config: ChannelConformanceConfig): void {
  describe(`channel adapter conformance: ${config.name}`, () => {
    let validators: ContractHarnessValidators;

    beforeAll(async () => {
      validators = await ContractHarnessValidators.getShared();
    });

    it("exposes channelType string", () => {
      expect(typeof config.adapter.channelType).toBe("string");
      expect(config.adapter.channelType.length).toBeGreaterThan(0);
      expect(config.adapter.channelType).toBe(config.expectedChannel);
    });

    it("describeCapabilities returns well-formed object", () => {
      const caps = config.adapter.describeCapabilities();
      expect(caps.channel).toBe(config.expectedChannel);
      expect(typeof caps.messaging.text).toBe("boolean");
      expect(typeof caps.streaming.progressiveUpdate).toBe("boolean");
      expect(typeof caps.delivery.edit).toBe("boolean");
    });

    it("accepts unknown input without throwing", () => {
      expect(() => config.adapter.canonicalize(config.validInput)).not.toThrow();
    });

    it("returns CanonicalizationResult (not thrown error) for valid input", () => {
      const result = config.adapter.canonicalize(config.validInput);
      expect(result).toHaveProperty("ok");
    });

    it("produces schema-valid message.received on success", () => {
      const result = config.adapter.canonicalize(config.validInput);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.event.event_type).toBe("message.received");

      const v = validators.validateEvent(result.event);
      expect(v.ok).toBe(true);
    });

    it("returns a stable idempotencyKey", () => {
      const r1 = config.adapter.canonicalize(config.validInput);
      const r2 = config.adapter.canonicalize(config.validInput);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;
      expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
      expect(r1.idempotencyKey.length).toBeGreaterThan(0);
    });

    it("sets correct channel type", () => {
      const result = config.adapter.canonicalize(config.validInput);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.event.channel).toBe(config.expectedChannel);
    });

    it("includes all required canonical fields", () => {
      const result = config.adapter.canonicalize(config.validInput);
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

    it("createSender returns a valid sender", () => {
      const result = config.adapter.canonicalize(config.validInput);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const sender = config.adapter.createSender(result.event);
      expect(typeof sender.send).toBe("function");
      if (config.adapter.describeCapabilities().delivery.edit) {
        expect(typeof sender.edit).toBe("function");
      }
    });

    it("does not throw for null input", () => {
      expect(() => config.adapter.canonicalize(null)).not.toThrow();
      const result = config.adapter.canonicalize(null);
      expect(result.ok).toBe(false);
    });

    it("does not throw for undefined input", () => {
      expect(() => config.adapter.canonicalize(undefined)).not.toThrow();
      const result = config.adapter.canonicalize(undefined);
      expect(result.ok).toBe(false);
    });

    for (const { label, input, expectedCode } of config.invalidInputs) {
      it(`rejects invalid input: ${label}`, () => {
        const result = config.adapter.canonicalize(input);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe(expectedCode);
        expect(result.error.message.length).toBeGreaterThan(0);
      });
    }
  });
}
