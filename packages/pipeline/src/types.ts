import type { CanonicalEvent } from "@cap/contract-harness";
import type { MiddlewareConfig } from "@cap/middleware";
import type { BackendConfig } from "@cap/backend-http";
import type { SendFn } from "@cap/delivery";
import type { LedgerStore } from "@cap/event-ledger";

export type PipelineConfig = {
  middleware: MiddlewareConfig;
  backend: BackendConfig;
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
