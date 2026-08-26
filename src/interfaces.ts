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
>[number] & {
  /**
   * User ids in the conversation, as of the last run that could read it.
   *
   * Slack's channel list does not carry this and there is no way to ask what
   * it was last year, so it exists only from the first run that recorded it.
   */
  members?: Array<string>;
};
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
  // userId -> every name they have gone by, oldest first. Searching for a name
  // somebody dropped in 2019 is the whole point of keeping the history.
  names?: Record<string, Array<string>>;
};

export type SearchMessage = {
  m?: string; // Message
  u?: string; // User
  t?: string; // Timestamp
  c?: string; // Channel
  /**
   * The timestamp of the message this one replies to, on thread replies only.
   *
   * It is what makes a reply linkable. The page index is built from top-level
   * timestamps, so a reply's own timestamp resolves to whichever page range
   * happens to contain it - the parent's page usually, and the wrong one
   * whenever a thread ran on past the messages below it. The page is found by
   * the parent; the anchor stays the reply's own id, which is rendered inside
   * the parent's block.
   */
  p?: string;
  /** Reactions on the message, carried into the index. */
  reactions?: Array<{
    name?: string;
    count?: number;
    users?: Array<string>;
  }>;
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
