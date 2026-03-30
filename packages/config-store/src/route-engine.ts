import type { RouteRecord } from "./types";

export type RouteContext = {
  channelName: string;
  messageText: string;
};

export type RouteDecision = {
  agentName: string;
  routeId: number;
  matchType: string;
  reason: string;
} | null;

export class RouteEngine {
  private routes: RouteRecord[] = [];
  private regexCache = new Map<string, RegExp>();

  load(routes: RouteRecord[]): void {
    this.routes = routes.filter((r) => r.enabled);
    this.regexCache.clear();
  }

  resolve(ctx: RouteContext): RouteDecision {
    let defaultRoute: RouteRecord | null = null;

    for (const route of this.routes) {
      switch (route.match_type) {
        case "channel":
          if (route.match_value === ctx.channelName) {
            return {
              agentName: route.agent_name,
              routeId: route.id,
              matchType: "channel",
              reason: `channel=${ctx.channelName}`,
            };
          }
          break;

        case "pattern":
          if (route.match_value) {
            const regex = this.getRegex(route.match_value);
            if (regex && regex.test(ctx.messageText)) {
              return {
                agentName: route.agent_name,
                routeId: route.id,
                matchType: "pattern",
                reason: `pattern=${route.match_value}`,
              };
            }
          }
          break;

        case "default":
          if (!defaultRoute || route.priority > defaultRoute.priority) {
            defaultRoute = route;
          }
          break;
      }
    }

    if (defaultRoute) {
      return {
        agentName: defaultRoute.agent_name,
        routeId: defaultRoute.id,
        matchType: "default",
        reason: "default_route",
      };
    }

    return null;
  }

  private getRegex(pattern: string): RegExp | null {
    const cached = this.regexCache.get(pattern);
    if (cached) return cached;
    try {
      const regex = new RegExp(pattern);
      this.regexCache.set(pattern, regex);
      return regex;
    } catch {
      return null;
    }
  }
}
