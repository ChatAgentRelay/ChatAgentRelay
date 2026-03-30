import { describe, expect, test } from "bun:test";
import { ContractHarnessValidators, loadSpecializedSchemas } from "../src";
import type { CanonicalEvent } from "../src";

function baseEvent(overrides: Partial<CanonicalEvent> & { event_type: string }): CanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    tenant_id: "tenant_test",
    workspace_id: "ws_test",
    channel: "test",
    channel_instance_id: "test_inst_1",
    conversation_id: "conv_1",
    session_id: "sess_1",
    correlation_id: `corr_${crypto.randomUUID()}`,
    occurred_at: new Date().toISOString(),
    actor_type: "end_user",
    payload: {},
    ...overrides,
  };
}

describe("agent HITL and status event schemas", () => {
  test("loads schemas for agent.status.changed, agent.input.requested, agent.input.provided", async () => {
    const schemas = await loadSpecializedSchemas();
    expect(Object.keys(schemas)).toContain("agent.status.changed");
    expect(Object.keys(schemas)).toContain("agent.input.requested");
    expect(Object.keys(schemas)).toContain("agent.input.provided");
  });

  test("validates agent.status.changed with required payload", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.status.changed",
      actor_type: "system",
      payload: {
        status: "working",
        session_handle: "sess_handle_1",
      },
    });
    expect(validators.validateEvent(event).ok).toBe(true);
  });

  test("validates agent.status.changed with optional message", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.status.changed",
      actor_type: "system",
      payload: {
        status: "completed",
        session_handle: "sess_handle_1",
        message: "Task finished successfully.",
      },
    });
    expect(validators.validateEvent(event).ok).toBe(true);
  });

  test("rejects agent.status.changed with invalid status enum", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.status.changed",
      actor_type: "system",
      payload: {
        status: "pending",
        session_handle: "sess_handle_1",
      },
    });
    expect(validators.validateSpecialized(event).ok).toBe(false);
  });

  test("rejects agent.status.changed missing session_handle", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.status.changed",
      actor_type: "system",
      payload: {
        status: "working",
      },
    });
    expect(validators.validateSpecialized(event).ok).toBe(false);
  });

  test("rejects agent.status.changed when actor_type is not system", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.status.changed",
      actor_type: "agent",
      payload: {
        status: "working",
        session_handle: "sess_handle_1",
      },
    });
    expect(validators.validateSpecialized(event).ok).toBe(false);
  });

  test("validates agent.input.requested with required payload", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.input.requested",
      actor_type: "agent",
      payload: {
        prompt: "Please confirm the shipping address.",
        session_handle: "sess_handle_1",
      },
    });
    expect(validators.validateEvent(event).ok).toBe(true);
  });

  test("validates agent.input.requested with optional metadata", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.input.requested",
      actor_type: "agent",
      payload: {
        prompt: "Choose A or B.",
        session_handle: "sess_handle_1",
        metadata: { choices: ["A", "B"] },
      },
    });
    expect(validators.validateEvent(event).ok).toBe(true);
  });

  test("rejects agent.input.requested missing prompt", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.input.requested",
      actor_type: "agent",
      payload: {
        session_handle: "sess_handle_1",
      },
    });
    expect(validators.validateSpecialized(event).ok).toBe(false);
  });

  test("validates agent.input.provided with required payload", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.input.provided",
      actor_type: "end_user",
      payload: {
        text: "123 Main St",
        session_handle: "sess_handle_1",
      },
    });
    expect(validators.validateEvent(event).ok).toBe(true);
  });

  test("validates agent.input.provided with optional input_event_id", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.input.provided",
      actor_type: "end_user",
      payload: {
        text: "Approved.",
        session_handle: "sess_handle_1",
        input_event_id: "evt_prior",
      },
    });
    expect(validators.validateEvent(event).ok).toBe(true);
  });

  test("rejects agent.input.provided missing text", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.input.provided",
      actor_type: "end_user",
      payload: {
        session_handle: "sess_handle_1",
      },
    });
    expect(validators.validateSpecialized(event).ok).toBe(false);
  });

  test("rejects agent.input.provided when actor_type is not end_user", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "agent.input.provided",
      actor_type: "agent",
      payload: {
        text: "oops",
        session_handle: "sess_handle_1",
      },
    });
    expect(validators.validateSpecialized(event).ok).toBe(false);
  });
});
