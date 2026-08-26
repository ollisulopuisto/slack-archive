import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import ora, { Ora } from "ora";
import { channelKind, getChannelName } from "./channels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  NO_SEARCH,
  HTML_EXCLUDE_KINDS,
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
  getUserStatuses,
  getUsers,
} from "./data-load.js";
import { buildSearchDatabase } from "./search-db.js";
import {
  botUserIds,
  excludedUserIds,
  isChannelSearchable,
  isMessageSearchable,
  toSearchMessages,
} from "./search-filter.js";
import { writeSearchData } from "./data-write.js";
import { reportTimings, timed } from "./timings.js";

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

/** Which timestamps start which page, for everything that has to find a
 * message: the search results, and now the archive's own permalinks. */
export function getPageIndex(): SearchPageIndex {
  return INDEX_OF_PAGES;
}

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

  await timed("search file", () => createSearchFile(spinner));
  await timed("search page", async () => createSearchHTML());
  await timed("search database", () => createSearchDatabase(spinner));

  spinner.succeed(`Search file created`);
  console.log(`\n ${reportTimings("Finished")}`);
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
    // The same merge createSearchFile does. INDEX_OF_PAGES is only populated
    // when create-html has run in this process; a build-db-only run has to
    // fall back to what the previous search.js recorded, or the index would
    // lose the page numbers every time the database is rebuilt on its own.
    pages: { ...(existingData.pages || {}), ...INDEX_OF_PAGES },
    names: await getUserNames(),
    statuses: await getUserStatuses(),
    channels: searchable
      .filter((channel) => !!channel.id)
      .map((channel) => ({
        id: channel.id!,
        name: getChannelName(channel),
        kind: channelKind(channel),
        isArchived: !!channel.is_archived,
        members: channel.members,
      })),
    onChannel: (channel) => {
      spinner.text = `Indexing database messages for channel ${channel.name}`;
      spinner.render();
    },
    loadMessages: async (channelId) => {
      const messages = toSearchMessages(await getMessages(channelId, true), {
        hiddenUsers,
        includeBots: SEARCH_INCLUDE_BOTS,
      });

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

/**
 * What the browser-side search file may contain.
 *
 * Everything the site excludes, plus everything the index excludes. A channel
 * kept out of either is kept out of this file: it is downloaded in full by
 * anyone who opens the search page, so it can enforce nothing itself.
 */
const SEARCH_FILE_EXCLUDE_KINDS = new Set([
  ...HTML_EXCLUDE_KINDS,
  ...SEARCH_EXCLUDE_KINDS,
]);

async function createSearchFile(spinner: Ora) {
  const existingData = await getSearchFile();
  const users = await getUsers();
  const channels = await getChannels();
  const userNames = await getUserNames();
  const result: SearchFile = {
    channels: {},
    users: {},
    messages: {},
    // Only the channels this file is allowed to describe.
    //
    // The page index is merged from every channel ever paginated, including
    // runs before any exclusion existed - so an unfiltered map named the DM
    // and private channels by id, with their page-boundary timestamps, inside
    // a file published to a website that contains none of them. No names and
    // no messages, but enough to say those conversations exist and roughly how
    // busy they were.
    pages: {},
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
  //
  // This file is part of the published SITE, so it takes the site's
  // exclusions - not the index's. The two consumers are different: search.db
  // is read by a bot that gates per user and may hold private channels;
  // search.js is downloaded whole by every visitor's browser and can gate
  // nothing. One flag feeding both put private-channel message text into a
  // file served to every logged-in member, including people who were never in
  // those channels.
  for (const [i, channel] of channels.entries()) {
    if (!isChannelSearchable(channel, SEARCH_FILE_EXCLUDE_KINDS)) {
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

    let messages = toSearchMessages(await getMessages(channel.id, true), {
      hiddenUsers,
      includeBots: SEARCH_INCLUDE_BOTS,
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

  // Built last, from the same list the messages came from, so a channel can
  // never appear in the page index without appearing in the file proper.
  const merged = { ...existingData.pages, ...INDEX_OF_PAGES };
  for (const channelId of Object.keys(result.channels)) {
    if (merged[channelId]) result.pages[channelId] = merged[channelId];
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
