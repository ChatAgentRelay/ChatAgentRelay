import type { CanonicalEvent, ValidationResult } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";
import type { MiddlewareConfig, MiddlewareResult } from "./types";

function deriveEvent(
  source: CanonicalEvent,
  causationId: string,
  eventType: string,
  payload: Record<string, unknown>,
): CanonicalEvent {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    schema_version: "v1alpha1",
    event_type: eventType,
    tenant_id: source.tenant_id,
    workspace_id: source.workspace_id,
    channel: source.channel,
    channel_instance_id: source.channel_instance_id ?? source.channel,
    conversation_id: source.conversation_id,
    session_id: source.session_id,
    correlation_id: source.correlation_id,
    causation_id: causationId,
    occurred_at: new Date().toISOString(),
    actor_type: "system",
    payload,
  };
}

export class MiddlewarePipeline {
  private constructor(
    private readonly validators: ContractHarnessValidators,
    private readonly config: MiddlewareConfig,
  ) {}

  static async create(config: MiddlewareConfig): Promise<MiddlewarePipeline> {
    const validators = await ContractHarnessValidators.create();
    return new MiddlewarePipeline(validators, config);
  }

  process(messageReceived: CanonicalEvent): MiddlewareResult {
    if (messageReceived.event_type !== "message.received") {
      throw new Error(`Expected message.received, got ${messageReceived.event_type}`);
    }

    const policyDecision = this.config.policyFn
      ? this.config.policyFn(messageReceived)
      : { decision: "allow" as const };

    const policyEvent = deriveEvent(
      messageReceived,
      messageReceived.event_id,
      "policy.decision.made",
      {
        policy: this.config.policyId ?? "default_ingress",
        decision: policyDecision.decision,
        ...(policyDecision.reason !== undefined ? { reason: policyDecision.reason } : {}),
      },
    );
    this.assertValid(policyEvent);

    if (policyDecision.decision === "deny") {
      return {
        allowed: false,
        policyEvent,
        denyReason: policyDecision.reason ?? "policy_deny",
      };
    }

    const routeEvent = deriveEvent(
      messageReceived,
      policyEvent.event_id,
      "route.decision.made",
      {
        route: this.config.route.route_id,
        reason: this.config.route.reason ?? "default_route",
      },
    );
    this.assertValid(routeEvent);

    const invocationEvent = deriveEvent(
      messageReceived,
      routeEvent.event_id,
      "agent.invocation.requested",
      {
        backend: this.config.route.backend,
        input_event_id: messageReceived.event_id,
      },
    );
    this.assertValid(invocationEvent);

    return { allowed: true, policyEvent, routeEvent, invocationEvent };
  }

  private assertValid(event: CanonicalEvent): void {
    const result: ValidationResult = this.validators.validateEvent(event);
    if (!result.ok) {
      const details = result.failure.issues.map((i) => i.message).join("; ");
      throw new Error(`Middleware produced invalid ${event.event_type}: ${details}`);
    }
  }
}
