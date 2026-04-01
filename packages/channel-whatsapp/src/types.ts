export type {
  CanonicalizationFailure,
  CanonicalizationResult,
  CanonicalizationSuccess,
  IngressError,
} from "@chat-agent-relay/contract-harness";

export type WhatsAppConfig = {
  phoneNumberId: string;
  accessToken: string;
  verifyToken?: string | undefined;
  appSecret?: string | undefined;
  defaultTenantId?: string | undefined;
  defaultWorkspaceId?: string | undefined;
};

export type WhatsAppTextMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: "text";
  text: { body: string };
};

export type WhatsAppStatus = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
};

export type WhatsAppChangeValue = {
  messaging_product: string;
  metadata?: {
    phone_number_id?: string | undefined;
    display_phone_number?: string | undefined;
  } | undefined;
  messages?: WhatsAppTextMessage[] | undefined;
  statuses?: WhatsAppStatus[] | undefined;
};

export type WhatsAppWebhookPayload = {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: WhatsAppChangeValue;
    }>;
  }>;
};

export type WhatsAppSendMessageResponse = {
  messages?: Array<{ id: string }> | undefined;
  error?: { message?: string | undefined } | undefined;
};

export type WhatsAppSessionInfo = {
  recipient: string;
  expiresAt: string;
};

export type WhatsAppSessionTracker = {
  record(session: WhatsAppSessionInfo): void;
  get(recipient: string): WhatsAppSessionInfo | undefined;
};
