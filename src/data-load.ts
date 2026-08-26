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
import { readJsonArraySync, readSearchDataSync } from "./big-json.js";

async function getFile<T>(filePath: string, returnIfEmpty: T): Promise<T> {
  if (!fs.existsSync(filePath)) {
    return returnIfEmpty;
  }

  const data: T = await readJSON(filePath);

  return data;
}

export const messagesCache: Record<string, Array<ArchiveMessage>> = {};

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
