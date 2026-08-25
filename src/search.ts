import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import ora, { Ora } from "ora";
import { channelKind, getChannelName } from "./channels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  NO_SEARCH,
  SEARCH_EXCLUDE_KINDS,
  SEARCH_EXCLUDE_USERS,
  SEARCH_INCLUDE_BOTS,
  SEARCH_DATA_PATH,
  SEARCH_DB_PATH,
  SEARCH_PATH,
  SEARCH_TEMPLATE_PATH,
} from "./config.js";
import { SearchFile, SearchMessage, SearchPageIndex } from "./interfaces.js";
import {
  getChannels,
  getMessages,
  getSearchFile,
  getUserNames,
  getUsers,
} from "./data-load.js";
import { buildSearchDatabase } from "./search-db.js";
import {
  botUserIds,
  excludedUserIds,
  isChannelSearchable,
  isMessageSearchable,
} from "./search-filter.js";
import { writeSearchData } from "./data-write.js";

// Format:
// channelId: [ timestamp0, timestamp1, timestamp2, ... ]
//
// channelId: [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
// pages: {
//   0: [ 10, 9, 8 ]
//   1: [ 7, 6, 5 ]
//   2: [ 4, 3, 2 ]
//   3: [ 1, 0 ]
// }
// INDEX_OF_PAGES: {
//   channelId: [8, 5, 2, 0]
// }
//
// For channelId, a message older than timestamp 0 but younger than timestamp1 is on page 1.
// In our example above, the message with timestamp 6 is older than 5 but younger than 8.
const INDEX_OF_PAGES: SearchPageIndex = {};

export function recordPage(channelId?: string, timestamp?: string) {
  if (!channelId || !timestamp) {
    console.warn(
      `Search: Cannot record page: channelId: ${channelId} timestamp: ${timestamp}`,
    );
    return;
  }

  if (!INDEX_OF_PAGES[channelId]) {
    INDEX_OF_PAGES[channelId] = [];
  }

  INDEX_OF_PAGES[channelId].push(timestamp);
}

export async function createSearch() {
  if (NO_SEARCH) return;

  const spinner = ora(`Creating search file...`).start();
  spinner.render();

  await createSearchFile(spinner);
  await createSearchHTML();
  await createSearchDatabase(spinner);

  spinner.succeed(`Search file created`);
}

export async function createSearchDatabase(spinner: Ora) {
  const existingData = await getSearchFile();
  const users = await getUsers();
  const channels = await getChannels();

  const names: Record<string, string> = {};
  for (const userId in users) {
    names[userId] = users[userId].name || users[userId].real_name || "Unknown";
  }

  // Withheld before anything is written, not filtered when something is read.
  const hiddenUsers = new Set([
    ...excludedUserIds(SEARCH_EXCLUDE_USERS, users),
    ...(SEARCH_INCLUDE_BOTS ? [] : botUserIds(users)),
  ]);
  const searchable = channels.filter((channel) =>
    isChannelSearchable(channel, SEARCH_EXCLUDE_KINDS),
  );

  if (searchable.length < channels.length) {
    spinner.info(
      `Search index excludes ${channels.length - searchable.length} channels (${[
        ...SEARCH_EXCLUDE_KINDS,
      ].join(", ")}) and ${hiddenUsers.size} users.`,
    );
    spinner.start();
  }

  await buildSearchDatabase(SEARCH_DB_PATH, {
    users: names,
    names: await getUserNames(),
    channels: searchable
      .filter((channel) => !!channel.id)
      .map((channel) => ({
        id: channel.id!,
        name: getChannelName(channel),
        kind: channelKind(channel),
        isArchived: !!channel.is_archived,
      })),
    onChannel: (channel) => {
      spinner.text = `Indexing database messages for channel ${channel.name}`;
      spinner.render();
    },
    loadMessages: async (channelId) => {
      const messages: SearchMessage[] = (await getMessages(channelId, true))
        .map((message) => ({
          m: message.text,
          u: message.user,
          t: message.ts,
          // Attachment metadata travels with the message so that a
          // caption-less image is findable by its filename. Only the fields
          // search needs: Slack's file object is large and the rest does not
          // belong in an index.
          files: (message.files || [])
            .filter((file: any) => file && file.id)
            .map((file: any) => ({
              id: file.id,
              name: file.name,
              title: file.title,
              filetype: file.filetype,
              mimetype: file.mimetype,
            })),
          // Reactions likewise. The index has held a table for them since
          // 7a47f2d; nothing was filling it, because the schema and the write
          // path landed without this line.
          reactions: (message.reactions || [])
            .filter((reaction: any) => reaction && reaction.name)
            .map((reaction: any) => ({
              name: reaction.name,
              count: reaction.count,
              users: reaction.users,
            })),
        }))
        // AFTER the map, not before. isMessageSearchable reads `u`, the mapped
        // short field, and an archive message calls it `user` - so filtering
        // the raw message tested a property that is never there, returned true
        // for everything, and excluded nothing while reporting that it had.
        // The types did not catch it: ArchiveMessage has an index signature,
        // so `.u` is a legal read that is always undefined.
        .filter((message) => isMessageSearchable(message, hiddenUsers));

      // Fall back to existing search data if the raw channel JSON file is
      // empty or missing - filtered the same way. The fallback reads the
      // PREVIOUS search.js, which was written before anything was excluded, so
      // handing it back unfiltered would quietly reinstate exactly what was
      // just withheld.
      if (messages.length === 0 && existingData.messages?.[channelId]) {
        return existingData.messages[channelId].filter((message) =>
          isMessageSearchable(message, hiddenUsers),
        );
      }

      return messages;
    },
  });
}

async function createSearchFile(spinner: Ora) {
  const existingData = await getSearchFile();
  const users = await getUsers();
  const channels = await getChannels();
  const userNames = await getUserNames();
  const result: SearchFile = {
    channels: {},
    users: {},
    messages: {},
    pages: { ...existingData.pages, ...INDEX_OF_PAGES },
    // Oldest first. Somebody looking for a name that was dropped in 2019 is
    // searching for the person, and this is the only place that connects them.
    names: Object.fromEntries(
      Object.entries(userNames).map(([userId, names]) => [
        userId,
        names.map((name) => name.nick),
      ]),
    ),
  };

  // Users
  for (const user in users) {
    result.users[user] = users[user].name || users[user].real_name || "Unknown";
  }

  const hiddenUsers = new Set([
    ...excludedUserIds(SEARCH_EXCLUDE_USERS, users),
    ...(SEARCH_INCLUDE_BOTS ? [] : botUserIds(users)),
  ]);

  // Channels & Messages
  for (const [i, channel] of channels.entries()) {
    if (!isChannelSearchable(channel, SEARCH_EXCLUDE_KINDS)) {
      continue;
    }

    if (!channel.id) {
      console.warn(
        `Can't create search file for channel ${channel.name}: No id found`,
        channel,
      );
      continue;
    }

    const name = getChannelName(channel);

    spinner.text = `Creating search messages for channel ${name}`;
    spinner.render();

    let messages = (await getMessages(channel.id, true)).map((message) => {
      const searchMessage: SearchMessage = {
        m: message.text,
        u: message.user,
        t: message.ts,
      };

      // Files belong in this mapping too, not only the one that builds the
      // database. buildSearchDatabase falls back to search.js's messages when
      // a channel's own JSON is missing, so without this the fallback would
      // drop every attachment - silently, and precisely on the machines where
      // only search.js was copied across.
      const files = (message.files || [])
        .filter((file: any) => file && file.id)
        .map((file: any) => ({
          id: file.id,
          name: file.name,
          title: file.title,
          filetype: file.filetype,
          mimetype: file.mimetype,
        }));
      if (files.length > 0) searchMessage.files = files;

      return searchMessage;
    });

    if (
      messages.length === 0 &&
      existingData.messages &&
      existingData.messages[channel.id]
    ) {
      // Filtered too: the previous search.js predates the exclusions.
      messages = existingData.messages[channel.id].filter((message) =>
        isMessageSearchable(message, hiddenUsers),
      );
    }

    result.messages![channel.id] = messages;
    result.channels[channel.id] = name;
  }

  await writeSearchData(SEARCH_DATA_PATH, result);
}

async function createSearchHTML() {
  let template = fs.readFileSync(SEARCH_TEMPLATE_PATH, "utf8");

  template = template.replace(
    "<!-- react -->",
    getScript(`react@18.3.1/umd/react.production.min.js`),
  );
  template = template.replace(
    "<!-- react-dom -->",
    getScript(`react-dom@18.3.1/umd/react-dom.production.min.js`),
  );
  template = template.replace(
    `<!-- babel -->`,
    getScript(`babel-standalone@6.26.0/babel.min.js`),
  );
  template = template.replace(
    `<!-- minisearch -->`,
    getScript("minisearch@7.2.0/dist/umd/index.min.js"),
  );

  // Read the compiled JS (types already stripped by tsc), then remove
  // `export` keywords so the functions are globals in the browser.
  const sharedQueryLogicJs = fs
    .readFileSync(path.join(__dirname, "./search-query.js"), "utf8")
    .replace(/export /g, "");

  template = template.replace(
    "<!-- search-query-logic -->",
    `<script type="text/javascript">${sharedQueryLogicJs}</script>`,
  );

  template = template.replace(`<!-- Size -->`, getSize());

  fs.outputFileSync(SEARCH_PATH, template);
}

function getSize() {
  const mb = fs.statSync(SEARCH_DATA_PATH).size / 1048576; //MB
  return `Loading ${Math.round(mb)}MB of data`;
}

function getScript(script: string) {
  return `<script crossorigin src="https://cdn.jsdelivr.net/npm/${script}"></script>`;
}
