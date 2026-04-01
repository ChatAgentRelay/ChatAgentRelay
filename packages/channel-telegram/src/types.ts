export type {
  CanonicalizationFailure,
  CanonicalizationResult,
  CanonicalizationSuccess,
  IngressError,
} from "@chat-agent-relay/contract-harness";

export type TelegramConfig = {
  botToken: string;
  secretToken?: string | undefined;
  defaultTenantId?: string | undefined;
  defaultWorkspaceId?: string | undefined;
};

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string | undefined;
  username?: string | undefined;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string | undefined;
  username?: string | undefined;
};

export type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser | undefined;
  chat: TelegramChat;
  date: number;
  text?: string | undefined;
  entities?: TelegramMessageEntity[] | undefined;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage | undefined;
};

export type TelegramSendMessageResponse = {
  ok: boolean;
  result?: {
    message_id: number;
    chat: TelegramChat;
    text: string;
    date: number;
  };
};
