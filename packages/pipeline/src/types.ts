import type { InvocationContext, InvocationResult } from "@chat-agent-relay/backend-http";
import type { CanonicalizationResult } from "@chat-agent-relay/channel-web-chat";
import type { CanonicalEvent } from "@chat-agent-relay/contract-harness";
import type { RetryConfig, SendFn } from "@chat-agent-relay/delivery";
import type { LedgerStore } from "@chat-agent-relay/event-ledger";
import type { MiddlewareConfig } from "@chat-agent-relay/middleware";

export interface BackendAdapter {
  invoke(context: InvocationContext): Promise<InvocationResult>;
  invokeStreaming?(context: InvocationContext): AsyncGenerator<string, InvocationResult>;
}

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

export type PipelineConfig = {
  middleware: MiddlewareConfig;
  backend: BackendAdapter;
  ingress: ChannelIngress;
  sendFn: SendFn;
  ledgerStore?: LedgerStore | undefined;
  retryConfig?: RetryConfig | undefined;
  streaming?: StreamingOptions | undefined;
};

export type PipelineResult = {
  events: CanonicalEvent[];
  blocked?: boolean | undefined;
  blockReason?: string | undefined;
  explanation: {
    inboundText: string;
    policyDecision: string;
    selectedRoute: string;
    backendResponse: string;
    providerMessageId: string;
  };
};
