import { describe, expect, test } from "bun:test";
import {
  assertFirstExecutablePathChain,
  ContractHarnessValidators,
  FIRST_EXECUTABLE_PATH_EVENT_ORDER,
  loadFirstExecutablePathFixtures,
  loadSpecializedSchemas,
  UnknownEventTypeError,
} from "../src";

function makeEvent(overrides: Record<string, unknown>) {
  return {
    event_id: "evt_test",
    schema_version: "v1alpha1",
    tenant_id: "tenant_acme",
    workspace_id: "ws_support",
    channel: "webchat",
    channel_instance_id: "webchat",
    conversation_id: "conv_1",
    session_id: "sess_1",
    correlation_id: "corr_1",
    occurred_at: "2026-03-17T12:00:01Z",
    actor_type: "system",
    payload: {},
    ...overrides,
  };
}

describe("contract harness", () => {
  test("loads specialized schemas for all known event types", async () => {
    const specializedSchemas = await loadSpecializedSchemas();
    const keys = Object.keys(specializedSchemas);

    for (const eventType of FIRST_EXECUTABLE_PATH_EVENT_ORDER) {
      expect(keys).toContain(eventType);
    }
    expect(keys).toContain("event.blocked");
  });

  test("validates every happy-path fixture envelope-first and specialized-second", async () => {
    const validators = await ContractHarnessValidators.create();
    const fixtures = await loadFirstExecutablePathFixtures();

    expect(fixtures.map(({ fileName }) => fileName)).toEqual([
      "01-message.received.json",
      "02-policy.decision.made.json",
      "03-route.decision.made.json",
      "04-agent.invocation.requested.json",
      "05-agent.response.completed.json",
      "06-message.send.requested.json",
      "07-message.sent.json",
    ]);
    expect(fixtures.map(({ event }) => event.event_type)).toEqual([...FIRST_EXECUTABLE_PATH_EVENT_ORDER]);

    for (const fixture of fixtures) {
      const envelopeResult = validators.validateEnvelope(fixture.event);
      expect(envelopeResult.ok).toBe(true);

      const specializedResult = validators.validateSpecialized(fixture.event);
      expect(specializedResult.ok).toBe(true);

      const validationResult = validators.validateEvent(fixture.event);
      expect(validationResult.ok).toBe(true);
    }
  });

  test("asserts chain-level invariants for the frozen fixture set", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();

    expect(() => assertFirstExecutablePathChain(fixtures.map(({ event }) => event))).not.toThrow();
  });

  test("fails explicitly for an unknown event_type", async () => {
    const validators = await ContractHarnessValidators.create();
    const fixtures = await loadFirstExecutablePathFixtures();
    const unknownEvent = {
      ...fixtures[0]!.event,
      event_type: "message.unknown",
    };

    expect(() => validators.resolveSpecializedValidator(unknownEvent.event_type)).toThrow(UnknownEventTypeError);
    expect(() => validators.validateSpecialized(unknownEvent)).toThrow(UnknownEventTypeError);
  });

  test("fails envelope validation for an invalid fixture", async () => {
    const validators = await ContractHarnessValidators.create();
    const fixtures = await loadFirstExecutablePathFixtures();
    const invalidEvent = { ...fixtures[0]!.event } as Record<string, unknown>;

    delete invalidEvent.event_id;

    const validationResult = validators.validateEnvelope(invalidEvent as never);

    expect(validationResult.ok).toBe(false);
    if (!validationResult.ok) {
      expect(validationResult.failure.step).toBe("envelope");
      expect(
        validationResult.failure.issues.some((issue) => issue.instancePath === "" && issue.keyword === "required"),
      ).toBe(true);
    }
  });

  test("fails specialized validation for a shape that violates the mapped schema", async () => {
    const validators = await ContractHarnessValidators.create();
    const fixtures = await loadFirstExecutablePathFixtures();
    const invalidEvent = {
      ...fixtures[0]!.event,
      payload: {},
    };

    const validationResult = validators.validateSpecialized(invalidEvent);

    expect(validationResult.ok).toBe(false);
    if (!validationResult.ok) {
      expect(validationResult.failure.step).toBe("specialized");
      expect(validationResult.failure.issues.some((issue) => issue.keyword === "required")).toBe(true);
    }
  });

  test("accepts policy.decision.made payloads with stage metadata", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = makeEvent({
      event_type: "policy.decision.made",
      causation_id: "evt_source",
      payload: {
        policy: "default_ingress",
        decision: "allow",
        stage: "outbound",
      },
    });

    const validationResult = validators.validateEvent(event as never);
    expect(validationResult.ok).toBe(true);
  });

  test("accepts event.blocked payloads with new v0.3 block stages", async () => {
    const validators = await ContractHarnessValidators.create();
    for (const blockStage of ["access_control", "rate_limit", "outbound_governance"]) {
      const event = makeEvent({
        event_type: "event.blocked",
        causation_id: "evt_source",
        payload: {
          reason: "blocked",
          block_stage: blockStage,
          retryable: false,
        },
      });

      const validationResult = validators.validateEvent(event as never);
      expect(validationResult.ok).toBe(true);
    }
  });
});
