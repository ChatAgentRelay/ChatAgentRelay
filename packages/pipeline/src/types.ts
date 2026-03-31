import type { CanonicalizationResult } from "@chat-agent-relay/channel-web-chat";
import type { AgentAdapter, CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { RetryConfig, SendFn } from "@chat-agent-relay/delivery";
import type { LedgerStore } from "@chat-agent-relay/event-ledger";

export interface ChannelIngress {
  canonicalize(raw: unknown): CanonicalizationResult;
}

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
  ingress: ChannelIngress;
  channelName: string;
  sendFn: SendFn;
  ledgerStore?: LedgerStore;
  streaming?: StreamingOptions;
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
