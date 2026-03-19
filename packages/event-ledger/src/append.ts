import { ContractHarnessValidators, type CanonicalEvent, type ValidationIssue } from "@cap/contract-harness";
import { LedgerDuplicateConflictError, LedgerValidationError } from "./errors";
import { InMemoryEventLedgerStore } from "./ledger-store";
import { REQUIRED_LEDGER_EVENT_FIELDS } from "./constants";
import type { AppendResult, StoredCanonicalEvent } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStoredCanonicalEvent(event: CanonicalEvent): StoredCanonicalEvent {
  for (const field of REQUIRED_LEDGER_EVENT_FIELDS) {
    if (!(field in event)) {
      throw new LedgerValidationError(`Missing required ledger field: ${field}`);
    }
  }

  if (typeof event.schema_version !== "string") {
    throw new LedgerValidationError("Expected schema_version to be a string");
  }

  if (typeof event.channel !== "string") {
    throw new LedgerValidationError("Expected channel to be a string");
  }

  if (typeof event.actor_type !== "string") {
    throw new LedgerValidationError("Expected actor_type to be a string");
  }

  if (!isRecord(event.payload)) {
    throw new LedgerValidationError("Expected payload to be an object");
  }

  if (event.channel_instance_id !== undefined && typeof event.channel_instance_id !== "string") {
    throw new LedgerValidationError("Expected channel_instance_id to be a string when present");
  }

  if (event.provider_extensions !== undefined && !isRecord(event.provider_extensions)) {
    throw new LedgerValidationError("Expected provider_extensions to be an object when present");
  }

  const storedEvent: StoredCanonicalEvent = {
    ...event,
    schema_version: event.schema_version,
    channel: event.channel,
    actor_type: event.actor_type,
    payload: structuredClone(event.payload),
  };

  if (typeof event.channel_instance_id === "string") {
    storedEvent.channel_instance_id = event.channel_instance_id;
  }

  if (isRecord(event.provider_extensions)) {
    storedEvent.provider_extensions = structuredClone(event.provider_extensions);
  }

  return storedEvent;
}

function areEventsEquivalent(left: StoredCanonicalEvent, right: StoredCanonicalEvent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class EventLedgerAppender {
  private constructor(
    private readonly validators: ContractHarnessValidators,
    private readonly store: InMemoryEventLedgerStore,
  ) {}

  static async create(store = new InMemoryEventLedgerStore()): Promise<EventLedgerAppender> {
    const validators = await ContractHarnessValidators.create();
    return new EventLedgerAppender(validators, store);
  }

  getStore(): InMemoryEventLedgerStore {
    return this.store;
  }

  append(event: CanonicalEvent): AppendResult {
    const validationResult = this.validators.validateEvent(event);

    if (!validationResult.ok) {
      const details = validationResult.failure.issues
        .map((issue: ValidationIssue) => `${issue.instancePath || "/"} ${issue.message}`)
        .join(", ");
      throw new LedgerValidationError(`Canonical validation failed at ${validationResult.failure.step}: ${details}`);
    }

    const storedEvent = toStoredCanonicalEvent(event);
    const existingEvent = this.store.getById(storedEvent.event_id);

    if (existingEvent) {
      if (!areEventsEquivalent(existingEvent, storedEvent)) {
        throw new LedgerDuplicateConflictError(storedEvent.event_id);
      }

      return {
        status: "duplicate",
        event: existingEvent,
      };
    }

    this.store.append(storedEvent);

    return {
      status: "appended",
      event: storedEvent,
    };
  }
}
