import type { CanonicalEvent } from "@cap/contract-harness";

export type RouteConfig = {
  route_id: string;
  backend: string;
  reason?: string | undefined;
};

export type PolicyDecision = {
  decision: "allow" | "deny";
  reason?: string | undefined;
};

export type PolicyFn = (event: CanonicalEvent) => PolicyDecision;

export type MiddlewareConfig = {
  policyId?: string | undefined;
  policyFn?: PolicyFn | undefined;
  route: RouteConfig;
};

export type MiddlewareAllowResult = {
  allowed: true;
  policyEvent: CanonicalEvent;
  routeEvent: CanonicalEvent;
  invocationEvent: CanonicalEvent;
};

export type MiddlewareDenyResult = {
  allowed: false;
  policyEvent: CanonicalEvent;
  denyReason: string;
};

export type MiddlewareResult = MiddlewareAllowResult | MiddlewareDenyResult;
