import { describe, expect, test } from "bun:test";
import { assertFirstExecutablePathChain, loadFirstExecutablePathFixtures } from "@cap/contract-harness";
import {
  EventLedgerAppender,
  EventLedgerReader,
  LedgerAuditExplanationError,
  LedgerDuplicateConflictError,
  explainFirstExecutablePath,
} from "../src";

function getPayloadString(event: { payload: Record<string, unknown> }, key: string): string {
  const value = event.payload[key];

  if (typeof value !== "string") {
    throw new Error(`Expected payload.${key} to be a string`);
  }

  return value;
}

async function loadLedger(): Promise<{ appender: EventLedgerAppender; reader: EventLedgerReader }> {
  const appender = await EventLedgerAppender.create();
  const reader = new EventLedgerReader(appender.getStore());

  return { appender, reader };
}

describe("event ledger", () => {
  test("validates and appends the frozen seven-event fixture chain", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender, reader } = await loadLedger();

    for (const fixture of fixtures) {
      const result = appender.append(fixture.event);
      expect(result.status).toBe("appended");
      expect(result.event.event_id).toBe(fixture.event.event_id);
      expect(result.event.schema_version).toBe(fixture.event.schema_version);
      expect(result.event.event_type).toBe(fixture.event.event_type);
      expect(result.event.tenant_id).toBe(fixture.event.tenant_id);
      expect(result.event.workspace_id).toBe(fixture.event.workspace_id);
      expect(result.event.channel).toBe(fixture.event.channel);
      expect(result.event.channel_instance_id).toBe(fixture.event.channel_instance_id);
      expect(result.event.conversation_id).toBe(fixture.event.conversation_id);
      expect(result.event.session_id).toBe(fixture.event.session_id);
      expect(result.event.correlation_id).toBe(fixture.event.correlation_id);
      expect(result.event.causation_id).toBe(fixture.event.causation_id);
      expect(result.event.occurred_at).toBe(fixture.event.occurred_at);
      expect(result.event.actor_type).toBe(fixture.event.actor_type);
      expect(result.event.payload).toEqual(fixture.event.payload);
      expect(result.event.provider_extensions).toEqual(fixture.event.provider_extensions);
    }

    const replayedEvents = reader.replayConversation(fixtures[0]!.event.conversation_id);
    expect(replayedEvents).toHaveLength(7);
    expect(() => assertFirstExecutablePathChain(replayedEvents)).not.toThrow();
  });

  test("returns an explicit duplicate result for an equivalent repeated append", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender, reader } = await loadLedger();
    const firstEvent = fixtures[0]!.event;

    const firstResult = appender.append(firstEvent);
    const duplicateResult = appender.append(firstEvent);

    expect(firstResult.status).toBe("appended");
    expect(duplicateResult.status).toBe("duplicate");
    expect(duplicateResult.event).toEqual(firstResult.event);
    expect(reader.replayConversation(firstEvent.conversation_id)).toHaveLength(1);
  });

  test("rejects a conflicting duplicate event_id append", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender } = await loadLedger();
    const firstEvent = fixtures[0]!.event;

    appender.append(firstEvent);

    const conflictingDuplicate = {
      ...firstEvent,
      payload: {
        text: "A different text body",
      },
    };

    expect(() => appender.append(conflictingDuplicate)).toThrow(LedgerDuplicateConflictError);
  });

  test("replays by conversation, finds by correlation, gets by id, and filters by time range", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender, reader } = await loadLedger();

    for (const fixture of fixtures) {
      appender.append(fixture.event);
    }

    const [messageReceived, , routeDecision, , agentResponse] = fixtures;
    const replayedEvents = reader.replayConversation(messageReceived!.event.conversation_id);
    const correlationEvents = reader.findByCorrelationId(messageReceived!.event.correlation_id);
    const fetchedEvent = reader.getEvent(agentResponse!.event.event_id);
    const timeRangeEvents = reader.findByTimeRange({
      start: routeDecision!.event.occurred_at,
      end: agentResponse!.event.occurred_at,
    });

    expect(replayedEvents.map((event) => event.event_id)).toEqual(fixtures.map(({ event }) => event.event_id));
    expect(correlationEvents.map((event) => event.event_id)).toEqual(replayedEvents.map((event) => event.event_id));
    expect(fetchedEvent).toEqual(replayedEvents[4]!);
    expect(timeRangeEvents.map((event) => event.event_id)).toEqual(
      fixtures.slice(2, 5).map(({ event }) => event.event_id),
    );
  });

  test("explains the frozen seven-event path from stored ledger facts alone", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender, reader } = await loadLedger();

    for (const fixture of fixtures) {
      appender.append(fixture.event);
    }

    const [messageReceived, policyDecision, routeDecision, agentInvocation, agentResponse, messageSendRequested, messageSent] = fixtures;
    const explanation = explainFirstExecutablePath(reader.replayConversation(messageReceived!.event.conversation_id));

    expect(explanation).toEqual({
      conversation_id: messageReceived!.event.conversation_id,
      correlation_id: messageReceived!.event.correlation_id,
      messageReceived: {
        event_id: messageReceived!.event.event_id,
        text: getPayloadString(messageReceived!.event, "text"),
      },
      policyDecision: {
        event_id: policyDecision!.event.event_id,
        decision: getPayloadString(policyDecision!.event, "decision"),
        policy: getPayloadString(policyDecision!.event, "policy"),
      },
      routeDecision: {
        event_id: routeDecision!.event.event_id,
        route: getPayloadString(routeDecision!.event, "route"),
        reason: getPayloadString(routeDecision!.event, "reason"),
      },
      agentInvocation: {
        event_id: agentInvocation!.event.event_id,
        backend: getPayloadString(agentInvocation!.event, "backend"),
        input_event_id: getPayloadString(agentInvocation!.event, "input_event_id"),
      },
      agentResponse: {
        event_id: agentResponse!.event.event_id,
        text: getPayloadString(agentResponse!.event, "text"),
      },
      messageSendRequested: {
        event_id: messageSendRequested!.event.event_id,
        text: getPayloadString(messageSendRequested!.event, "text"),
      },
      messageSent: {
        event_id: messageSent!.event.event_id,
        provider_message_id: getPayloadString(messageSent!.event, "provider_message_id"),
      },
    });
  });

  test("fails audit explanation when the stored facts do not cover the full seven-event chain", async () => {
    const fixtures = await loadFirstExecutablePathFixtures();
    const { appender, reader } = await loadLedger();

    for (const fixture of fixtures.slice(0, 6)) {
      appender.append(fixture.event);
    }

    expect(() => explainFirstExecutablePath(reader.replayConversation(fixtures[0]!.event.conversation_id))).toThrow(
      LedgerAuditExplanationError,
    );
  });
});
