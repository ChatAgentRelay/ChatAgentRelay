import { assertFirstExecutablePathChain } from "@cap/contract-harness";
import { AUDIT_EVENT_TYPES } from "./constants";
import { LedgerAuditExplanationError } from "./errors";
import type { AuditExplanation, StoredCanonicalEvent } from "./types";

function getPayloadValue(event: StoredCanonicalEvent, key: string): string {
  const value = event.payload[key];

  if (typeof value !== "string") {
    throw new LedgerAuditExplanationError(`Expected payload.${key} to be a string for ${event.event_type}`);
  }

  return value;
}

function requireEvent(events: StoredCanonicalEvent[], eventType: string): StoredCanonicalEvent {
  const event = events.find((candidate) => candidate.event_type === eventType);

  if (!event) {
    throw new LedgerAuditExplanationError(`Missing required event type ${eventType}`);
  }

  return event;
}

function assertCausalChain(events: StoredCanonicalEvent[]): void {
  for (let index = 1; index < events.length; index += 1) {
    const previousEvent = events[index - 1];
    const currentEvent = events[index];

    if (!previousEvent || !currentEvent) {
      throw new LedgerAuditExplanationError("Expected ordered events to form a complete chain");
    }

    if (currentEvent.causation_id !== previousEvent.event_id) {
      throw new LedgerAuditExplanationError(
        `Expected ${currentEvent.event_id} causation_id to equal ${previousEvent.event_id}`,
      );
    }
  }
}

export function explainFirstExecutablePath(events: StoredCanonicalEvent[]): AuditExplanation {
  if (events.length !== 7) {
    throw new LedgerAuditExplanationError(`Expected 7 events for the first executable path, received ${events.length}`);
  }

  assertFirstExecutablePathChain(events);
  assertCausalChain(events);

  const messageReceived = requireEvent(events, AUDIT_EVENT_TYPES.messageReceived);
  const policyDecision = requireEvent(events, AUDIT_EVENT_TYPES.policyDecisionMade);
  const routeDecision = requireEvent(events, AUDIT_EVENT_TYPES.routeDecisionMade);
  const agentInvocation = requireEvent(events, AUDIT_EVENT_TYPES.agentInvocationRequested);
  const agentResponse = requireEvent(events, AUDIT_EVENT_TYPES.agentResponseCompleted);
  const messageSendRequested = requireEvent(events, AUDIT_EVENT_TYPES.messageSendRequested);
  const messageSent = requireEvent(events, AUDIT_EVENT_TYPES.messageSent);

  return {
    conversation_id: messageReceived.conversation_id,
    correlation_id: messageReceived.correlation_id,
    messageReceived: {
      event_id: messageReceived.event_id,
      text: getPayloadValue(messageReceived, "text"),
    },
    policyDecision: {
      event_id: policyDecision.event_id,
      decision: getPayloadValue(policyDecision, "decision"),
      policy: getPayloadValue(policyDecision, "policy"),
    },
    routeDecision: {
      event_id: routeDecision.event_id,
      route: getPayloadValue(routeDecision, "route"),
      reason: getPayloadValue(routeDecision, "reason"),
    },
    agentInvocation: {
      event_id: agentInvocation.event_id,
      backend: getPayloadValue(agentInvocation, "backend"),
      input_event_id: getPayloadValue(agentInvocation, "input_event_id"),
    },
    agentResponse: {
      event_id: agentResponse.event_id,
      text: getPayloadValue(agentResponse, "text"),
    },
    messageSendRequested: {
      event_id: messageSendRequested.event_id,
      text: getPayloadValue(messageSendRequested, "text"),
    },
    messageSent: {
      event_id: messageSent.event_id,
      provider_message_id: getPayloadValue(messageSent, "provider_message_id"),
    },
  };
}
