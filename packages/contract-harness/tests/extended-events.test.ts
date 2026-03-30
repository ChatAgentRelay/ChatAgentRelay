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

describe("extended event schemas", () => {
  test("loads schemas for all extended event types", async () => {
    const schemas = await loadSpecializedSchemas();
    const keys = Object.keys(schemas);
    expect(keys).toContain("message.updated");
    expect(keys).toContain("message.deleted");
    expect(keys).toContain("reaction.received");
    expect(keys).toContain("command.received");
  });

  test("validates message.updated with correct payload", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "message.updated",
      payload: {
        original_message_id: "msg_123",
        new_text: "edited text",
        previous_text: "original text",
      },
    });
    const result = validators.validateEvent(event);
    expect(result.ok).toBe(true);
  });

  test("rejects message.updated missing required fields", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "message.updated",
      payload: { original_message_id: "msg_123" },
    });
    const result = validators.validateSpecialized(event);
    expect(result.ok).toBe(false);
  });

  test("validates message.deleted with correct payload", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "message.deleted",
      actor_type: "system",
      payload: {
        deleted_message_id: "msg_456",
        deleted_text: "was here",
      },
    });
    const result = validators.validateEvent(event);
    expect(result.ok).toBe(true);
  });

  test("rejects message.deleted missing deleted_message_id", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "message.deleted",
      payload: {},
    });
    const result = validators.validateSpecialized(event);
    expect(result.ok).toBe(false);
  });

  test("validates reaction.received with correct payload", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "reaction.received",
      actor_type: "end_user",
      payload: {
        emoji: "thumbsup",
        target_message_id: "msg_789",
        action: "added",
      },
    });
    const result = validators.validateEvent(event);
    expect(result.ok).toBe(true);
  });

  test("rejects reaction.received missing emoji", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "reaction.received",
      actor_type: "end_user",
      payload: { target_message_id: "msg_789" },
    });
    const result = validators.validateSpecialized(event);
    expect(result.ok).toBe(false);
  });

  test("rejects reaction.received with invalid action value", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "reaction.received",
      actor_type: "end_user",
      payload: {
        emoji: "thumbsup",
        target_message_id: "msg_789",
        action: "toggled",
      },
    });
    const result = validators.validateSpecialized(event);
    expect(result.ok).toBe(false);
  });

  test("validates command.received with correct payload", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "command.received",
      actor_type: "end_user",
      payload: {
        command_name: "status",
        text: "check server",
        arguments: { verbose: true },
      },
    });
    const result = validators.validateEvent(event);
    expect(result.ok).toBe(true);
  });

  test("rejects command.received missing command_name", async () => {
    const validators = await ContractHarnessValidators.create();
    const event = baseEvent({
      event_type: "command.received",
      actor_type: "end_user",
      payload: { text: "check server" },
    });
    const result = validators.validateSpecialized(event);
    expect(result.ok).toBe(false);
  });
});
