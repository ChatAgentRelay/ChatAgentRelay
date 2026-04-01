export type LarkConfig = {
  appId: string;
  appSecret: string;
  defaultTenantId?: string | undefined;
  defaultWorkspaceId?: string | undefined;
  verificationToken?: string | undefined;
  encryptKey?: string | undefined;
};

export type LarkEventWrapper = {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: Record<string, unknown>;
};

export type LarkMention = {
  key: string;
  id: { open_id: string };
  name: string;
};

export type LarkMessageEvent = {
  sender: {
    sender_id: { open_id: string };
    sender_type: string;
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
    mentions?: LarkMention[] | undefined;
  };
};

export type LarkSendMessageResponse = {
  code: number;
  msg: string;
  data?: { message_id: string } | undefined;
};
