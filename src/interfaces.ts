import {
  ConversationsHistoryResponse,
  ConversationsListResponse,
  UsersInfoResponse,
  FilesInfoResponse,
  ReactionsGetResponse,
  AuthTestResponse,
} from "@slack/web-api";

// We need the specific element types from the responses
export type User = NonNullable<UsersInfoResponse["user"]>;
export type Channel = NonNullable<
  ConversationsListResponse["channels"]
>[number];
export type Message = {
  ts: string;
  user?: string;
  text?: string;
  files?: any[];
  reactions?: any[];
  reply_count?: number;
  replies?: Message[];
  [key: string]: any;
};
export type File = NonNullable<FilesInfoResponse["file"]>;
export type Reaction = {
  name?: string;
  count?: number;
  users?: string[];
  [key: string]: any;
};

/**
 * What a conversation is, as one value rather than a set of flags that can
 * contradict each other. Slack reports overlapping booleans - a DM carries
 * `is_private` too - so the archive stores the resolved answer instead of
 * asking every reader to resolve it again, identically, forever.
 */
export type ChannelKind = "public" | "private" | "mpim" | "im";

export type Users = Record<string, User>;

export type Emojis = Record<string, string>;

export interface ArchiveMessage extends Message {}

export type SearchPageIndex = Record<string, Array<string>>;

export type SearchFile = {
  users: Record<string, string>; // userId -> userName
  channels: Record<string, string>; // channelId -> channelName
  messages: Record<string, Array<SearchMessage>>;
  pages: SearchPageIndex;
};

export type SearchMessage = {
  m?: string; // Message
  u?: string; // User
  t?: string; // Timestamp
  c?: string; // Channel
  /**
   * Attachment metadata, for search. Without it an image posted with no
   * caption cannot be found by any term at all: its message text is empty.
   */
  files?: Array<{
    id?: string;
    name?: string;
    title?: string;
    filetype?: string;
    mimetype?: string;
  }>;
};

export interface SlackArchiveChannelData {
  messages: number;
  fullyDownloaded: boolean;
}

export interface SlackArchiveData {
  channels: Record<string, SlackArchiveChannelData>;
  auth?: AuthTestResponse;
}

export interface ChunkInfo {
  oldest?: string;
  newest?: string;
  count: number;
}

export type ChunksInfo = Array<ChunkInfo>;
