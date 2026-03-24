import type { CanonicalEvent } from "@cap/contract-harness";
import type { InvocationContext, InvocationResult } from "@cap/backend-http";
import type { CanonicalizationResult } from "@cap/channel-web-chat";
import type { SendFn } from "@cap/delivery";
import type { MiddlewareConfig } from "@cap/middleware";
import type { LedgerStore } from "@cap/event-ledger";

export interface BackendAdapter {
  invoke(context: InvocationContext): Promise<InvocationResult>;
}

export interface ChannelIngress {
  canonicalize(raw: unknown): CanonicalizationResult;
}

export type PipelineConfig = {
  middleware: MiddlewareConfig;
  backend: BackendAdapter;
  ingress: ChannelIngress;
  sendFn: SendFn;
  ledgerStore?: LedgerStore | undefined;
};

export type PipelineResult = {
  events: CanonicalEvent[];
  explanation: {
    inboundText: string;
    policyDecision: string;
    selectedRoute: string;
    backendResponse: string;
    providerMessageId: string;
  };
};
