import type { CanonicalEvent } from "@cap/contract-harness";
import type { InvocationContext, InvocationResult } from "@cap/backend-http";
import type { CanonicalizationResult } from "@cap/channel-web-chat";
import type { SendFn, RetryConfig } from "@cap/delivery";
import type { MiddlewareConfig } from "@cap/middleware";
import type { LedgerStore } from "@cap/event-ledger";

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
