import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const config = {
  token: process.env.SLACK_TOKEN,
};

function findCliParameter(param: string) {
  const args = process.argv;

  for (const arg of args) {
    if (arg === param) {
      return true;
    }
  }

  return false;
}

function getCliParameter(param: string) {
  const args = process.argv;

  for (const [i, arg] of args.entries()) {
    if (arg === param) {
      return args[i + 1];
    }
  }

  return null;
}

function getNumberCliParameter(param: string, fallback: number) {
  const value = getCliParameter(param);

  if (value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    console.warn(
      `Ignoring ${param}=${value}: expected a number of zero or more. Using ${fallback}.`,
    );
    return fallback;
  }

  return parsed;
}

export const AUTOMATIC_MODE = findCliParameter("--automatic");
export const USE_PREVIOUS_CHANNEL_CONFIG = findCliParameter(
  "--use-previous-channel-config",
);
export const CHANNEL_TYPES = getCliParameter("--channel-types");
export const NO_BACKUP = findCliParameter("--no-backup");
export const NO_SEARCH = findCliParameter("--no-search");
export const NO_FILE_DOWNLOAD = findCliParameter("--no-file-download");
export const NO_SLACK_CONNECT = findCliParameter("--no-slack-connect");
export const FORCE_HTML_GENERATION = findCliParameter(
  "--force-html-generation",
);
export const EXCLUDE_CHANNELS = getCliParameter("--exclude-channels");

/**
 * Where attachments are served from, if not from beside the HTML.
 *
 * The pages are 563 MB and fit on a small VPS; the attachments are 41 GB and do
 * not. With this set to e.g. `https://host/media/` the generated HTML points at
 * a proxy in front of the storage box holding them, and nothing else changes.
 * Empty means relative `files/...`, which is what a local archive wants.
 */
export function normalizeBaseUrl(value: string): string {
  const trimmed = (value || "").trim();

  // Exactly one trailing slash, or nothing at all. Getting this wrong is
  // invisible in review and produces https://host/mediafiles/C123/F1.png on
  // every image in the archive.
  return trimmed ? `${trimmed.replace(/\/+$/, "")}/` : "";
}

export const FILES_BASE_URL = normalizeBaseUrl(
  getCliParameter("--files-base-url") || "",
);

/**
 * Channel kinds the search index must never hold, e.g. `im,mpim`.
 *
 * Empty by default: an archive of your own workspace is not automatically a
 * thing you are publishing, and silently dropping half of somebody's index on
 * upgrade would be its own surprise. The archives that ARE published say so.
 */
export const SEARCH_EXCLUDE_KINDS = new Set(
  (getCliParameter("--search-exclude-kinds") || "")
    .split(",")
    .map((kind) => kind.trim().toLowerCase())
    .filter((kind) => kind.length > 0),
);

/**
 * Keep bots in the search index. Off by default.
 *
 * Slackbot alone is 5.6% of this archive, in short repetitive autoresponses on
 * common words - which puts them in exactly the queries people run. Nobody
 * archives a decade of Slack to preserve Slackbot telling them to palauta
 * kissa. Unlike the DM exclusion this needs no naming and no configuration:
 * users.json marks the account and bot_id marks the message.
 */
export const SEARCH_INCLUDE_BOTS = findCliParameter("--search-include-bots");

/**
 * Channel kinds to leave out of the generated HTML entirely, e.g. `im,mpim`.
 *
 * Not rendering beats gating. A page that was never written cannot leak through
 * a wrong proxy rule, a forgotten auth block or a shared cookie - and the
 * archive was built with one person's user token, so their DMs are their
 * conversations with named other people. They can publish their own half of
 * those; not the other half.
 *
 * This filters the pages AND the counting. Excluding only the pages would leave
 * every profile's channel list naming the DM channels and every total including
 * them, which says who talks to whom privately and how much.
 */
export const HTML_EXCLUDE_KINDS = new Set(
  (getCliParameter("--html-exclude-kinds") || "")
    .split(",")
    .map((kind) => kind.trim().toLowerCase())
    .filter((kind) => kind.length > 0),
);

/**
 * Users whose messages the search index must never hold, by handle or id.
 *
 * DO NOT REMOVE A BOT FROM THIS LIST WITHOUT READING THIS.
 *
 * It looks like tidying - "why is the bot excluded, index everything" - and in
 * this archive it closes a loop that currently does not exist. The Slack bot
 * can share an archived image back into a channel; the next run archives that
 * channel, so the image is in the archive twice. It cannot be found and shared
 * a third time only because the bot's own messages are never indexed, so the
 * re-post never becomes a search result.
 *
 * Index them and the cycle gets its second iteration: searches start returning
 * the bot's copies of their own results, attributed to the bot and dated to
 * whenever it re-posted them, and the archive fills with echoes wearing the
 * wrong name and date. It would not fail loudly - it would slowly get worse,
 * and the change that caused it would be in a different repository from the
 * symptom.
 *
 * Bots that post ORIGINAL content are a different case and are indexed on
 * purpose; the exclusion is for the ones that repeat what is already here.
 */
export const SEARCH_EXCLUDE_USERS = (
  getCliParameter("--search-exclude-users") || ""
)
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

/**
 * Users whose attached files are never downloaded, by handle or id.
 *
 * For anything that posts back what the archive already holds. A bot that
 * shares an archived image into a channel creates a real message with a real
 * file; downloading it stores a second copy of a picture already in the
 * archive, under a new id, permanently, for every share.
 *
 * Separate from `--search-exclude-users` on purpose. They overlap for
 * reposting bots, and they answer different questions: somebody kept out of
 * the index because they asked to be should still have their pictures kept.
 */
export const EXCLUDE_USER_FILES = (
  getCliParameter("--exclude-user-files") || ""
)
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

/**
 * How many `data_backup_<timestamp>` directories to keep, newest first.
 *
 * Each run copies the whole data directory before touching it, so on a nightly
 * schedule this is the difference between a constant amount of disk and a
 * growing one. Two: the run before this one, and the one before that.
 */
export const KEEP_BACKUPS = getNumberCliParameter("--keep-backups", 2);

/**
 * How many cores to render channel pages on. 0 picks a sensible number, 1
 * renders in this process the way it always did.
 *
 * Measured on a ten-year archive: rendering the channel pages is 2m32s of a
 * 3m11s run, and every page is independent of every other.
 */
export const RENDER_WORKERS = getNumberCliParameter("--render-workers", 0);

/**
 * The channel the front page offers to open, by name or id.
 *
 * Every workspace has one room that is the workspace, and no default can know
 * its name. Unset, the front page offers the busiest channel, which is a
 * better guess than whichever one sorts first.
 */
export const START_CHANNEL = getCliParameter("--start-channel") || "";

/**
 * The timezone every timestamp is rendered in, e.g. `Europe/Helsinki`.
 *
 * Unset, the archive uses the machine's own, which is right when one machine
 * renders it and wrong the moment two do: a container has no timezone and so
 * renders in UTC, and the same messages then carry different wall-clock times
 * depending on who published last.
 */
export const TIMEZONE = getCliParameter("--timezone") || "";

/**
 * Which search index the archive builds: `db`, `js` or `both`.
 *
 * There are two, because they answer different situations and neither covers
 * the other.
 *
 * The database is read by the browser over HTTP range requests - a few
 * hundred kilobytes per query instead of the whole corpus - which is the only
 * way the search page works on a phone. It needs a server: `file://` has no
 * range requests and no same-origin worker, so a database index is unusable
 * in an archive somebody unzips and double-clicks.
 *
 * The JavaScript index is one `<script>` tag holding every message, which is
 * exactly why it works from a folder of files and exactly why it kills mobile
 * Safari at a hundred megabytes.
 *
 * Both, by default: an archive should still be a folder that works on its own,
 * and the publish passes `--search-index db` because the site is served.
 */
export function searchIndexes(value: string) {
  const setting = (value || "both").trim().toLowerCase();

  if (setting !== "db" && setting !== "js" && setting !== "both") {
    throw new Error(
      `--search-index ${value}: expected db, js or both. ` +
        `db is read over the network, js is one file that works from file://.`,
    );
  }

  return {
    db: setting === "db" || setting === "both",
    js: setting === "js" || setting === "both",
  };
}

export const SEARCH_INDEX = searchIndexes(
  getCliParameter("--search-index") || "",
);
export const BASE_DIR = process.cwd();
export const OUT_DIR = path.join(BASE_DIR, "slack-archive");
export const TOKEN_FILE = path.join(OUT_DIR, ".token");
export const DATE_FILE = path.join(OUT_DIR, ".last-successful-run");
export const DATA_DIR = path.join(OUT_DIR, "data");
export const HTML_DIR = path.join(OUT_DIR, "html");
export const FILES_DIR = path.join(HTML_DIR, "files");
export const AVATARS_DIR = path.join(HTML_DIR, "avatars");
export const EMOJIS_DIR = path.join(HTML_DIR, "emojis");

export const INDEX_PATH = path.join(OUT_DIR, "index.html");
export const SEARCH_PATH = path.join(OUT_DIR, "search.html");
export const NAMES_PATH = path.join(HTML_DIR, "names.html");
/** Which timestamps start which page, so a permalink can find its message. */
export const PAGES_INDEX_PATH = path.join(HTML_DIR, "pages.js");
/**
 * The channel list on its own, for the search page, which is a template rather
 * than something this renderer writes.
 *
 * In data/ rather than html/ because it is a build input, not a page: in html/
 * it gets counted as one, and published as a fragment nobody should be able to
 * open.
 */
export const SIDEBAR_PATH = path.join(DATA_DIR, "sidebar.html");
export const STATS_PATH = path.join(HTML_DIR, "stats.html");
export const BOTS_PATH = path.join(HTML_DIR, "bots.html");

/**
 * Where a past profile picture lives. Keyed by the date in Slack's own URL,
 * which is what identifies one picture rather than another.
 */
export function getAvatarHistoryFilePath(
  userId: string,
  date: string,
  extension: string,
) {
  return path.join(AVATARS_DIR, "history", userId, `${date}${extension}`);
}

export function getChannelStatsFilePath(channelId: string) {
  return path.join(HTML_DIR, `channel-${channelId}.html`);
}

export function getProfileFilePath(userId: string) {
  return path.join(HTML_DIR, `user-${userId}.html`);
}
export const MESSAGES_JS_PATH = path.join(__dirname, "../static/scroll.js");
export const SEARCH_TEMPLATE_PATH = path.join(
  __dirname,
  "../static/search.html",
);
export const CHANNELS_DATA_PATH = path.join(DATA_DIR, "channels.json");
export const USERS_DATA_PATH = path.join(DATA_DIR, "users.json");
export const EMOJIS_DATA_PATH = path.join(DATA_DIR, "emojis.json");
export const USER_NAMES_DATA_PATH = path.join(DATA_DIR, "user-names.json");
export const USER_AVATARS_DATA_PATH = path.join(DATA_DIR, "user-avatars.json");
export const USER_STATUS_DATA_PATH = path.join(DATA_DIR, "user-status.json");
export const SLACK_ARCHIVE_DATA_PATH = path.join(
  DATA_DIR,
  "slack-archive.json",
);
export const SEARCH_DATA_PATH = path.join(DATA_DIR, "search.js");
export const SEARCH_DB_PATH = path.join(DATA_DIR, "search.db");

export function getChannelDataFilePath(channelId: string) {
  return path.join(DATA_DIR, `${channelId}.json`);
}

export function getChannelUploadFilePath(channelId: string, fileName: string) {
  return path.join(FILES_DIR, channelId, fileName);
}

export function getHTMLFilePath(channelId: string, index: number) {
  return path.join(HTML_DIR, `${channelId}-${index}.html`);
}

export function getAvatarFilePath(userId: string, extension: string) {
  return path.join(AVATARS_DIR, `${userId}${extension}`);
}
