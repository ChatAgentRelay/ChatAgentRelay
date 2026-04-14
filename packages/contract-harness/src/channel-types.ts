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

// ─── Rich Message Types (shared across channels) ─────────────────────────

export type RichTextBlock = { type: "text"; text: string };
export type RichCodeBlock = { type: "code"; text: string; language?: string };
export type RichHeaderBlock = { type: "header"; text: string };
export type RichDividerBlock = { type: "divider" };
export type RichBlock = RichTextBlock | RichCodeBlock | RichHeaderBlock | RichDividerBlock;
export type RichMessage = { blocks: RichBlock[]; fallbackText: string };

// ─── Inbound Attachment (populated by channel canonicalizers) ─────────────

export type InboundAttachment = {
  attachment_id: string;
  kind: "file" | "image" | "video" | "audio";
  mime_type?: string;
  filename?: string;
  url?: string;
  size_bytes?: number;
};

// ─── Outbound Attachment (for delivery to channels) ──────────────────────

export type OutboundAttachment = {
  name: string;
  mimeType: string;
  uri?: string;
  bytes?: string;
};

// ─── Button / Interactive Action ─────────────────────────────────────────

export type ButtonAction = {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
  value?: string;
};

// ─── Channel Sender Interface ────────────────────────────────────────────

export interface ChannelSender {
  send(text: string): Promise<{ providerMessageId: string }>;
  edit?(providerMessageId: string, text: string): Promise<void>;
  sendTyping?(): Promise<void>;
  addReaction?(messageId: string, emoji: string): Promise<void>;
  sendRichMessage?(message: RichMessage): Promise<{ providerMessageId: string }>;
  sendAttachment?(attachment: OutboundAttachment): Promise<{ providerMessageId: string }>;
  sendButtons?(text: string, buttons: ButtonAction[]): Promise<{ providerMessageId: string }>;
}

export interface ChannelAdapter {
  readonly channelType: string;
  describeCapabilities(): ChannelCapabilities;
  canonicalize(raw: unknown): CanonicalizationResult;
  createSender(event: CanonicalEvent): ChannelSender;
}
