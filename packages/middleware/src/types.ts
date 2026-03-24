import type { CanonicalEvent } from "@cap/contract-harness";

export type RouteConfig = {
  route_id: string;
  backend: string;
  reason?: string | undefined;
};

export type MiddlewareConfig = {
  policyId?: string | undefined;
  route: RouteConfig;
};

export type MiddlewareResult = {
  policyEvent: CanonicalEvent;
  routeEvent: CanonicalEvent;
  invocationEvent: CanonicalEvent;
};
