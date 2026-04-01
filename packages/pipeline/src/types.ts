import type { AgentAdapter, CanonicalEvent, CanonicalizationResult, ChannelAdapter } from "@chat-agent-relay/contract-harness";
import type { RetryConfig } from "@chat-agent-relay/delivery";
import type { LedgerStore } from "@chat-agent-relay/event-ledger";
import type { AccessControlConfig, RateLimiter } from "@chat-agent-relay/middleware";

export type { ChannelAdapter, CanonicalizationResult };

export type StreamingUpdateFn = (text: string) => Promise<void>;

export type StreamingOptions = {
  enabled: boolean;
  updateIntervalMs?: number | undefined;
  postInitial: (placeholder: string) => Promise<{ providerMessageId: string }>;
  updateMessage: StreamingUpdateFn;
};

export type RouteDecision = {
  agentName: string;
  routeId: number;
  matchType: string;
  reason: string;
};

export type RouteFn = (channelName: string, messageText: string) => RouteDecision | null;

export type PipelineConfig = {
  resolveAgent: (name: string) => AgentAdapter | undefined;
  routeFn: RouteFn;
  policyId?: string;
  policyFn?: (event: CanonicalEvent) => { decision: "allow" | "deny"; reason?: string };
  outboundPolicyId?: string;
  outboundPolicyFn?: (event: CanonicalEvent) => { decision: "allow" | "deny"; reason?: string };
  accessControl?: AccessControlConfig;
  rateLimiter?: RateLimiter;
  channel: ChannelAdapter;
  ledgerStore?: LedgerStore;
  streamingEnabled?: boolean;
  streamingIntervalMs?: number;
  streamingOverride?: StreamingOptions;
  retryConfig?: RetryConfig;
};

export type PipelineResult = {
  events: CanonicalEvent[];
  blocked?: boolean | undefined;
  blockReason?: string | undefined;
  hitlPending?: boolean | undefined;
  sessionHandle?: string | undefined;
  explanation: {
    inboundText: string;
    policyDecision: string;
    selectedRoute: string;
    backendResponse: string;
    providerMessageId: string;
  };
};
