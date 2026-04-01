export type {
  CanonicalizationFailure,
  CanonicalizationResult,
  CanonicalizationSuccess,
  IngressError,
} from "@chat-agent-relay/contract-harness";

export type DingTalkConfig = {
  webhookUrl?: string;
  secret?: string;
  defaultTenantId?: string;
  defaultWorkspaceId?: string;
};

export type DingTalkRobotCallback = {
  msgtype: string;
  text: { content: string };
  msgId: string;
  createAt: number;
  conversationType: string;
  conversationId: string;
  conversationTitle?: string;
  senderId: string;
  senderNick: string;
  senderStaffId?: string;
  senderCorpId?: string;
  chatbotUserId: string;
  chatbotCorpId?: string;
  isAdmin?: boolean;
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
  isInAtList?: boolean;
  atUsers?: Array<{ dingtalkId: string; staffId?: string }>;
};

export type DingTalkSendResponse = {
  errcode: number;
  errmsg: string;
};
