import { describe, it, expect, beforeAll } from "bun:test";
import type { CanonicalEvent } from "@cap/contract-harness";
import { ContractHarnessValidators } from "@cap/contract-harness";
import { MiddlewarePipeline } from "../src/middleware";
import type { MiddlewareConfig } from "../src/types";

function sampleMessageReceived(): CanonicalEvent {
  return {
    event_id: "evt_100",
    schema_version: "v1alpha1",
    event_type: "message.received",
    tenant_id: "tenant_acme",
    workspace_id: "ws_support",
    channel: "webchat",
    channel_instance_id: "webchat_acme_prod",
    conversation_id: "conv_1",
    session_id: "sess_1",
    correlation_id: "corr_1",
    occurred_at: "2026-03-18T10:00:00Z",
    actor_type: "end_user",
    payload: { text: "Where is my order?" },
  };
}

const defaultConfig: MiddlewareConfig = {
  route: {
    route_id: "default_webchat_agent",
    backend: "generic-http-agent",
    reason: "default_first_path_route",
  },
};

describe("middleware pipeline", () => {
  let pipeline: MiddlewarePipeline;
  let validators: ContractHarnessValidators;

  beforeAll(async () => {
    pipeline = await MiddlewarePipeline.create(defaultConfig);
    validators = await ContractHarnessValidators.create();
  });

  it("produces three contract-valid events from message.received", () => {
    const result = pipeline.process(sampleMessageReceived());
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;

    expect(result.policyEvent.event_type).toBe("policy.decision.made");
    expect(result.routeEvent.event_type).toBe("route.decision.made");
    expect(result.invocationEvent.event_type).toBe("agent.invocation.requested");

    for (const event of [result.policyEvent, result.routeEvent, result.invocationEvent]) {
      const v = validators.validateEvent(event);
      expect(v.ok).toBe(true);
    }
  });

  it("preserves correlation chain from message.received", () => {
    const msg = sampleMessageReceived();
    const result = pipeline.process(msg);
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;

    expect(result.policyEvent.correlation_id).toBe("corr_1");
    expect(result.routeEvent.correlation_id).toBe("corr_1");
    expect(result.invocationEvent.correlation_id).toBe("corr_1");
  });

  it("builds correct causal linkage: msg -> policy -> route -> invocation", () => {
    const msg = sampleMessageReceived();
    const result = pipeline.process(msg);
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;

    expect(result.policyEvent.causation_id).toBe(msg.event_id);
    expect(result.routeEvent.causation_id).toBe(result.policyEvent.event_id);
    expect(result.invocationEvent.causation_id).toBe(result.routeEvent.event_id);
  });

  it("emits allow decision with configured policy", () => {
    const result = pipeline.process(sampleMessageReceived());
    expect(result.policyEvent.payload["decision"]).toBe("allow");
    expect(result.policyEvent.payload["policy"]).toBe("default_ingress");
  });

  it("emits route decision with configured route and reason", () => {
    const result = pipeline.process(sampleMessageReceived());
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;

    expect(result.routeEvent.payload["route"]).toBe("default_webchat_agent");
    expect(result.routeEvent.payload["reason"]).toBe("default_first_path_route");
  });

  it("emits invocation with configured backend and input reference", () => {
    const msg = sampleMessageReceived();
    const result = pipeline.process(msg);
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;

    expect(result.invocationEvent.payload["backend"]).toBe("generic-http-agent");
    expect(result.invocationEvent.payload["input_event_id"]).toBe(msg.event_id);
  });

  it("all three events have actor_type = system", () => {
    const result = pipeline.process(sampleMessageReceived());
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;

    expect(result.policyEvent.actor_type).toBe("system");
    expect(result.routeEvent.actor_type).toBe("system");
    expect(result.invocationEvent.actor_type).toBe("system");
  });

  it("uses custom policyId when configured", async () => {
    const custom = await MiddlewarePipeline.create({
      policyId: "custom_policy",
      route: { route_id: "r1", backend: "b1" },
    });
    const result = custom.process(sampleMessageReceived());
    expect(result.policyEvent.payload["policy"]).toBe("custom_policy");
  });

  it("rejects non message.received input", () => {
    const wrongEvent = { ...sampleMessageReceived(), event_type: "route.decision.made" };
    expect(() => pipeline.process(wrongEvent)).toThrow("Expected message.received");
  });

  it("returns deny result when policyFn denies", async () => {
    const denyPipeline = await MiddlewarePipeline.create({
      policyId: "content_filter",
      policyFn: () => ({ decision: "deny", reason: "blocked_keyword_detected" }),
      route: { route_id: "r1", backend: "b1" },
    });
    const result = denyPipeline.process(sampleMessageReceived());

    expect(result.allowed).toBe(false);
    if (result.allowed) return;

    expect(result.policyEvent.payload["decision"]).toBe("deny");
    expect(result.policyEvent.payload["policy"]).toBe("content_filter");
    expect(result.denyReason).toBe("blocked_keyword_detected");

    const v = validators.validateEvent(result.policyEvent);
    expect(v.ok).toBe(true);
  });

  it("policyFn receives the message event", async () => {
    let receivedText = "";
    const inspectPipeline = await MiddlewarePipeline.create({
      policyFn: (event) => {
        receivedText = event.payload["text"] as string;
        return { decision: "allow" };
      },
      route: { route_id: "r1", backend: "b1" },
    });
    inspectPipeline.process(sampleMessageReceived());
    expect(receivedText).toBe("Where is my order?");
  });
});
