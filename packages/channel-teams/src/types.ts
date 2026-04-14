import type {
  ButtonAction,
  CanonicalizationFailure,
  CanonicalizationResult,
  CanonicalizationSuccess,
  IngressError,
  RichMessage,
} from "@chat-agent-relay/contract-harness";

export type TeamsConfig = {
  appId: string;
  appSecret: string;
  tenantId: string;
  defaultTenantId?: string | undefined;
  defaultWorkspaceId?: string | undefined;
  serviceUrl?: string | undefined;
};

export type TeamsTokenResponse = {
  access_token?: string | undefined;
  token_type?: string | undefined;
  expires_in?: number | undefined;
};

export type TeamsConversationReference = {
  serviceUrl: string;
  conversationId: string;
  tenantId?: string | undefined;
  activityId?: string | undefined;
};

export type TeamsActivityConversation = {
  id: string;
  tenantId?: string | undefined;
};

export type TeamsActivityFrom = {
  id: string;
  name?: string | undefined;
};

export type TeamsChannelData = {
  tenant?: { id?: string | undefined } | undefined;
  teamsChannelId?: string | undefined;
};

export type TeamsActivity = {
  id?: string | undefined;
  type: string;
  text?: string | undefined;
  timestamp?: string | undefined;
  serviceUrl?: string | undefined;
  channelId?: string | undefined;
  conversation?: TeamsActivityConversation | undefined;
  from?: TeamsActivityFrom | undefined;
  recipient?: TeamsActivityFrom | undefined;
  channelData?: TeamsChannelData | undefined;
};

export type TeamsSender = {
  sendMessage(reference: TeamsConversationReference, text: string): Promise<{ messageId: string }>;
  sendRichMessage(reference: TeamsConversationReference, message: RichMessage): Promise<{ messageId: string }>;
  sendButtons(
    reference: TeamsConversationReference,
    text: string,
    buttons: ButtonAction[],
  ): Promise<{ messageId: string }>;
  editMessage(reference: TeamsConversationReference, messageId: string, text: string): Promise<void>;
};

export type TeamsTokenManager = {
  getToken(): Promise<string>;
};

export type { CanonicalizationFailure, CanonicalizationResult, CanonicalizationSuccess, IngressError };
