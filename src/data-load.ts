import fs from "fs-extra";

import {
  ArchiveMessage,
  Channel,
  Emojis,
  SearchFile,
  Users,
} from "./interfaces.js";
import { UserNames } from "./user-names.js";
import { UserAvatars } from "./user-avatars.js";
import { UserStatuses } from "./user-status.js";
import {
  CHANNELS_DATA_PATH,
  EMOJIS_DATA_PATH,
  getChannelDataFilePath,
  SEARCH_DATA_PATH,
  USERS_DATA_PATH,
  USER_NAMES_DATA_PATH,
  USER_AVATARS_DATA_PATH,
  USER_STATUS_DATA_PATH,
} from "./config.js";
import { retry } from "./retry.js";
import {
  ElementSpan,
  readJsonArraySliceSync,
  readJsonArraySync,
  readJsonArrayWithSpansSync,
  readSearchDataSync,
} from "./big-json.js";

async function getFile<T>(filePath: string, returnIfEmpty: T): Promise<T> {
  if (!fs.existsSync(filePath)) {
    return returnIfEmpty;
  }

  const data: T = await readJSON(filePath);

  return data;
}

export const messagesCache: Record<string, Array<ArchiveMessage>> = {};

/**
 * Forget the parsed messages.
 *
 * The counting pass reads every message in the archive - 1.5 GB of JSON here -
 * and the render workers then read what they need for themselves. Keeping the
 * parent's copy while eight workers allocate their own is how a machine with
 * 32 GB runs out of it.
 */
export function clearMessagesCache() {
  for (const channelId of Object.keys(messagesCache)) {
    delete messagesCache[channelId];
  }
}

export async function getMessages(
  channelId: string,
  cachedOk: boolean = false,
): Promise<Array<ArchiveMessage>> {
  if (cachedOk && messagesCache[channelId]) {
    return messagesCache[channelId];
  }

  const filePath = getChannelDataFilePath(channelId);
  messagesCache[channelId] = await readMessagesFile(filePath);

  return messagesCache[channelId];
}

/**
 * A busy channel's message file can be bigger than the longest string V8 will
 * make, which `readJSONSync` would need. `readJsonArraySync` only takes that
 * path when the file is small enough for it.
 */
async function readMessagesFile(
  filePath: string,
): Promise<Array<ArchiveMessage>> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return retry({ name: `Loading messages from ${filePath}` }, () =>
    readJsonArraySync<ArchiveMessage>(filePath),
  );
}

/**
 * The messages of one channel, and where each of them sits in the file.
 *
 * The spans are what let the pages of this channel be rendered on different
 * cores: a page is a run of elements, a run of elements is one byte range, and
 * a worker can then read a megabyte instead of the whole file.
 */
export async function getMessagesWithSpans(
  channelId: string,
): Promise<{ messages: Array<ArchiveMessage>; spans: Array<ElementSpan> }> {
  const filePath = getChannelDataFilePath(channelId);

  if (!fs.existsSync(filePath)) {
    return { messages: [], spans: [] };
  }

  const { items, spans } = await retry(
    { name: `Loading messages and spans from ${filePath}` },
    () => readJsonArrayWithSpansSync<ArchiveMessage>(filePath),
  );

  messagesCache[channelId] = items;

  return { messages: items, spans };
}

/**
 * Open channel files, kept between pages.
 *
 * A worker renders one page after another out of the same file, and opening it
 * per page means 714 opens for one channel. On a local disk that is waste; on
 * an SMB share it is 714 sessions, and Synology answers the eventual one with
 * "Too many users" - which is what stopped the first run of this.
 */
const openFiles = new Map<string, number>();

function openChannelFile(filePath: string): number {
  const open = openFiles.get(filePath);

  if (open !== undefined) return open;

  const handle = fs.openSync(filePath, "r");
  openFiles.set(filePath, handle);

  return handle;
}

export function closeChannelFiles() {
  for (const [filePath, handle] of openFiles) {
    try {
      fs.closeSync(handle);
    } catch {
      // Already gone: nothing to do, and nothing worth saying.
    }
    openFiles.delete(filePath);
  }
}

/** One page's worth of messages, by the byte range the planner recorded. */
export async function getMessageSlice(
  channelId: string,
  span: ElementSpan,
): Promise<Array<ArchiveMessage>> {
  const filePath = getChannelDataFilePath(channelId);

  if (!fs.existsSync(filePath) || span.end <= span.start) {
    return [];
  }

  return retry({ name: `Loading messages ${span.start}-${span.end}` }, () =>
    readJsonArraySliceSync<ArchiveMessage>(filePath, span, {
      file: openChannelFile(filePath),
    }),
  );
}

export async function getUsers(): Promise<Users> {
  return getFile<Users>(USERS_DATA_PATH, {});
}

export async function getEmoji(): Promise<Emojis> {
  return getFile<Emojis>(EMOJIS_DATA_PATH, {});
}

export async function getUserStatuses(): Promise<UserStatuses> {
  return getFile<UserStatuses>(USER_STATUS_DATA_PATH, {});
}

export async function getUserAvatars(): Promise<UserAvatars> {
  return getFile<UserAvatars>(USER_AVATARS_DATA_PATH, {});
}

export async function getUserNames(): Promise<UserNames> {
  return getFile<UserNames>(USER_NAMES_DATA_PATH, {});
}

export async function getChannels(): Promise<Array<Channel>> {
  return getFile<Array<Channel>>(CHANNELS_DATA_PATH, []);
}

export async function getSearchFile(): Promise<SearchFile> {
  // See search.ts: the file is a JS assignment, not JSON, and it is far too
  // big for one string once a workspace has a few hundred thousand messages.
  return retry({ name: `Loading ${SEARCH_DATA_PATH}` }, () =>
    readSearchDataSync(SEARCH_DATA_PATH),
  );
}

export async function readJSON<T>(filePath: string) {
  return retry<T>({ name: `Loading JSON from ${filePath}` }, () => {
    return fs.readJSONSync(filePath);
  });
}
