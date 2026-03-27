import type { BackendInvocationRequest, InvocationContext } from "./types";

const DEFAULT_ROUTE = { route_id: "default", reason: "default_route" } as const;
const DEFAULT_POLICY = { policy_id: "default", decision: "allow" } as const;

export function buildBackendRequest(context: InvocationContext): BackendInvocationRequest {
  const requestId = `req_${crypto.randomUUID()}`;

  const request: BackendInvocationRequest = {
    request_id: requestId,
    car: {
      event: context.invocationEvent,
      input: {
        message: { text: context.messageText },
      },
      context: {
        route: context.route ?? DEFAULT_ROUTE,
        policy: context.policy ?? DEFAULT_POLICY,
      },
    },
  };

  if (context.backendSessionHandle !== undefined) {
    request.backend_session = { handle: context.backendSessionHandle };
  }

  return request;
}
