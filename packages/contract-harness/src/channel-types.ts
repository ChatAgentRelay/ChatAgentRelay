import type { CanonicalEvent } from "./types";

export type IngressError = {
  code: string;
  message: string;
  field?: string;
};

export type CanonicalizationSuccess = {
  ok: true;
  event: CanonicalEvent;
  idempotencyKey: string;
};

export type CanonicalizationFailure = {
  ok: false;
  error: IngressError;
};

export type CanonicalizationResult = CanonicalizationSuccess | CanonicalizationFailure;

export type ChannelCapabilities = {
  channel: string;
  messaging: { text: boolean; attachments: boolean; reactions: boolean; threads: boolean };
  streaming: { progressiveUpdate: boolean; nativeStreaming: boolean };
  interactive: { buttons: boolean; menus: boolean; commands: boolean };
  delivery: { retry: boolean; chunking: boolean; edit: boolean };
};

export interface ChannelSender {
  send(text: string): Promise<{ providerMessageId: string }>;
  edit?(providerMessageId: string, text: string): Promise<void>;
}

export interface ChannelAdapter {
  readonly channelType: string;
  describeCapabilities(): ChannelCapabilities;
  canonicalize(raw: unknown): CanonicalizationResult;
  createSender(event: CanonicalEvent): ChannelSender;
}
