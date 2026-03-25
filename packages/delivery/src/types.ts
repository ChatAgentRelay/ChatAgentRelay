import type { CanonicalEvent } from "@cap/contract-harness";

export type SendResult = {
  providerMessageId: string;
};

export type SendFn = (text: string) => Promise<SendResult>;

export type RetryConfig = {
  maxRetries?: number | undefined;
  baseDelayMs?: number | undefined;
};

export type DeliveryResult = {
  sendRequestedEvent: CanonicalEvent;
  sentEvent: CanonicalEvent;
  providerMessageId: string;
};
