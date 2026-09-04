import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import ora, { Ora } from "ora";
import { channelKind, getChannelName } from "./channels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  NO_SEARCH,
  EMOJI_INDEX_PATH,
  HTML_EXCLUDE_KINDS,
  SEARCH_EXCLUDE_KINDS,
  SEARCH_EXCLUDE_USERS,
  SEARCH_INCLUDE_BOTS,
  SEARCH_DATA_PATH,
  SEARCH_DB_PATH,
  SEARCH_PATH,
  SEARCH_TEMPLATE_PATH,
  SIDEBAR_PATH,
  HTML_DIR,
  SEARCH_INDEX,
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
import { getEmojiIndex } from "./emoji.js";
import { buildSearchDatabase } from "./search-db.js";
import {
  botUserIds,
  collectIndexedUserIds,
  excludedUserIds,
  isChannelSearchable,
  isMessageSearchable,
  pickVisibleUsers,
  toSearchMessages,
} from "./search-filter.js";
import { writeSearchData } from "./data-write.js";
import { reportTimings, timed } from "./timings.js";
import { contentSecurityPolicy } from "./csp.js";

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

  // The page is built either way and picks whichever index it was given; what
  // this decides is which ones exist to pick from. See --search-index.
  if (SEARCH_INDEX.js) {
    await timed("search file", () => createSearchFile(spinner));
  }

  await timed("search page", async () => createSearchHTML());

  if (SEARCH_INDEX.db) {
    await timed("search database", () => createSearchDatabase(spinner));
  }

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
    names: {},
  };

  const visibleUsers = new Set<string>();

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

    for (const userId of collectIndexedUserIds({
      messages,
      members: channel.members,
    })) {
      visibleUsers.add(userId);
    }
  }

  // Only people who appear in this file. The workspace directory names
  // everyone, including those who only ever DMed, and this file is
  // downloaded whole by anyone who opens search.
  const directory: Record<string, string> = {};
  for (const userId of visibleUsers) {
    if (!users[userId]) continue;
    directory[userId] =
      users[userId].name || users[userId].real_name || "Unknown";
  }
  result.users = directory;
  result.names = Object.fromEntries(
    Object.entries(pickVisibleUsers(userNames, visibleUsers)).map(
      ([userId, names]) => [userId, names.map((name) => name.nick)],
    ),
  );

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
    "<!-- csp -->",
    `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy({})}" />`,
  );

  copyNodeModuleFile(["react", "umd", "react.production.min.js"], "react.js");
  copyNodeModuleFile(
    ["react-dom", "umd", "react-dom.production.min.js"],
    "react-dom.js",
  );
  writeBrowserScript("search-app.js", compiledSearchApp());
  writeBrowserScript(
    "search-indexes.js",
    `window.SEARCH_INDEXES = ${JSON.stringify(SEARCH_INDEX)};\n`,
  );

  template = template.replace(
    "<!-- react -->",
    `<script src="html/react.js"></script>`,
  );
  template = template.replace(
    "<!-- react-dom -->",
    `<script src="html/react-dom.js"></script>`,
  );
  template = template.replace(
    "<!-- search-indexes -->",
    `<script src="html/search-indexes.js"></script>`,
  );
  template = template.replace(
    "<!-- search-app -->",
    `<script src="html/search-app.js"></script>`,
  );

  if (SEARCH_INDEX.db) {
    // Copied out of node_modules rather than fetched from a CDN, because a
    // Worker must be same-origin: a cross-origin worker script is refused by
    // the browser, and the page is nothing without it.
    copySqliteRuntime();

    template = template.replace(
      `<!-- sql-httpvfs -->`,
      `<script src="html/sql-httpvfs.js"></script>`,
    );
  }

  if (SEARCH_INDEX.js) {
    copyNodeModuleFile(
      ["minisearch", "dist", "umd", "index.js"],
      "minisearch.js",
    );

    template = template.replace(
      `<!-- minisearch -->`,
      `<script src="html/minisearch.js"></script>`,
    );

    template = template.replace(
      "<!-- search-data -->",
      `<script defer src="data/search.js" type="text/javascript"></script>`,
    );
  }

  writeStrippedModule("search-query.js");
  template = template.replace(
    "<!-- search-query-logic -->",
    `<script src="html/search-query.js"></script>`,
  );

  writeEmojiIndex();

  template = template.replace(
    "<!-- emoji-index -->",
    `<script type="text/javascript" src="html/emoji.js"></script>`,
  );

  writeStrippedModule("emoji-render.js");
  template = template.replace(
    "<!-- emoji-render -->",
    `<script src="html/emoji-render.js"></script>`,
  );

  writeStrippedModule("search-sql.js");
  template = template.replace(
    "<!-- search-sql -->",
    `<script src="html/search-sql.js"></script>`,
  );

  template = template.replace(`<!-- Size -->`, getSize());

  // The channel list, rendered by create-html, which runs before this. Without
  // it the search page is the only page in the archive with no way back into
  // it - so if it is missing, say so rather than shipping that page.
  if (fs.existsSync(SIDEBAR_PATH)) {
    template = template.replace(
      "<!-- sidebar -->",
      fs.readFileSync(SIDEBAR_PATH, "utf8"),
    );
  } else {
    console.warn(
      `Search page has no sidebar: ${SIDEBAR_PATH} was not written by the render.`,
    );
  }

  fs.outputFileSync(SEARCH_PATH, template);
}

/**
 * What the search page needs to show an emoji rather than its shortcode.
 *
 * The results are raw message text: whatever somebody typed, shortcodes and
 * all. Every other page in the archive turns those into emoji at render time,
 * so the search page was the one place where a custom emoji stayed
 * `:nuclear-huutonaurut:` - which reads as though the archive had failed to
 * fetch a picture it in fact has on disk.
 */
function writeEmojiIndex() {
  const index = getEmojiIndex();

  fs.outputFileSync(
    EMOJI_INDEX_PATH,
    `window.ARCHIVE_EMOJI = ${JSON.stringify(index)};\n`,
  );
}

function getSize() {
  // What the reader's browser will actually fetch. With the database that is
  // a few hundred kilobytes per query, whatever the file weighs; with the
  // JavaScript index it is the whole thing, which is what the old page meant
  // when it said "Loading 124MB of data" and meant it literally.
  const size = (file: string) =>
    fs.existsSync(file) ? Math.round(fs.statSync(file).size / 1048576) : 0;

  if (SEARCH_INDEX.db) {
    return `Reading a ${size(SEARCH_DB_PATH)}MB index a few kilobytes at a time`;
  }

  return `Loading ${size(SEARCH_DATA_PATH)}MB of data`;
}

/**
 * The three files the browser needs to read a database over the network.
 *
 * They sit beside the pages rather than on a CDN because the worker has to be
 * same-origin, and because an archive that is published behind a login should
 * not need a third party to be up in order to be searchable.
 */
function copyNodeModuleFile(from: Array<string>, to: string) {
  const source = path.join(__dirname, "..", "node_modules", ...from);

  if (!fs.existsSync(source)) {
    throw new Error(`Cannot build the search page: ${source} is missing.`);
  }

  fs.copySync(source, path.join(HTML_DIR, to));
}

/** tsc output with `export` / `import` removed so it is a browser global script. */
function writeStrippedModule(name: string) {
  const source = path.join(__dirname, name);

  if (!fs.existsSync(source)) {
    throw new Error(`Cannot build the search page: ${source} is missing.`);
  }

  writeBrowserScript(
    name,
    fs
      .readFileSync(source, "utf8")
      .replace(/^import .+;?\n/gm, "")
      .replace(/export /g, ""),
  );
}

function compiledSearchApp(): string {
  const source = path.join(__dirname, "search-app.js");

  if (!fs.existsSync(source)) {
    throw new Error(
      `Cannot build the search page: ${source} is missing. ` +
        `tsc compiles src/search-app.tsx; run npm run compile.`,
    );
  }

  return fs
    .readFileSync(source, "utf8")
    .replace(/^import .+;?\n/gm, "")
    .replace(/export \{\};\n?/g, "");
}

function writeBrowserScript(name: string, contents: string) {
  fs.outputFileSync(path.join(HTML_DIR, name), contents);
}

function copySqliteRuntime() {
  const dist = path.join(
    __dirname,
    "..",
    "node_modules",
    "sql.js-httpvfs",
    "dist",
  );
  const files: Array<[string, string]> = [
    ["index.js", "sql-httpvfs.js"],
    ["sqlite.worker.js", "sqlite.worker.js"],
    ["sql-wasm.wasm", "sql-wasm.wasm"],
  ];

  for (const [from, to] of files) {
    const source = path.join(dist, from);

    if (!fs.existsSync(source)) {
      throw new Error(
        `Cannot build the search page: ${source} is missing. ` +
          `sql.js-httpvfs is what reads the index in the browser.`,
      );
    }

    fs.copySync(source, path.join(HTML_DIR, to));
  }
}
