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

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number | undefined;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string | undefined;
  mime_type?: string | undefined;
  file_size?: number | undefined;
};

export type TelegramVideo = {
  file_id: string;
  file_unique_id: string;
  width?: number | undefined;
  height?: number | undefined;
  duration?: number | undefined;
  mime_type?: string | undefined;
  file_name?: string | undefined;
  file_size?: number | undefined;
};

export type TelegramAudioLike = {
  file_id: string;
  file_unique_id: string;
  duration?: number | undefined;
  mime_type?: string | undefined;
  file_name?: string | undefined;
  file_size?: number | undefined;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser | undefined;
  chat: TelegramChat;
  date: number;
  text?: string | undefined;
  entities?: TelegramMessageEntity[] | undefined;
  photo?: TelegramPhotoSize[] | undefined;
  document?: TelegramDocument | undefined;
  video?: TelegramVideo | undefined;
  audio?: TelegramAudioLike | undefined;
  voice?: TelegramAudioLike | undefined;
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
