import path from "path";
import { uniqBy } from "lodash-es";
import inquirer from "inquirer";
import fs from "fs-extra";
import ora from "ora";

import {
  CHANNELS_DATA_PATH,
  USERS_DATA_PATH,
  getChannelDataFilePath,
  OUT_DIR,
  config,
  TOKEN_FILE,
  AUTOMATIC_MODE,
  USE_PREVIOUS_CHANNEL_CONFIG,
  CHANNEL_TYPES,
  DATE_FILE,
  EMOJIS_DATA_PATH,
  USER_NAMES_DATA_PATH,
  USER_AVATARS_DATA_PATH,
  USER_STATUS_DATA_PATH,
  getAvatarHistoryFilePath,
  NO_SLACK_CONNECT,
  NO_FILE_DOWNLOAD,
  EXCLUDE_CHANNELS,
} from "./config.js";
import { downloadExtras } from "./messages.js";
import { downloadMessages } from "./messages.js";
import { downloadFilesForChannel, downloadURL } from "./download-files.js";
import {
  createHtmlForChannels,
  getChannelsToCreateFilesFor,
} from "./create-html.js";
import { createBackup, deleteBackup, deleteOlderBackups } from "./backup.js";
import { isValid, parseISO } from "date-fns";
import { createSearch } from "./search.js";
import { write, writeAndMerge, writeJsonArray } from "./data-write.js";
import {
  messagesCache,
  getMessages,
  getUsers,
  getChannels,
  getUserNames,
  getUserAvatars,
  getUserStatuses,
} from "./data-load.js";
import { mineNames, recordNames, snapshotNames } from "./user-names.js";
import {
  markRefused,
  mineAvatars,
  pendingAvatars,
  recordAvatars,
  UserAvatars,
} from "./user-avatars.js";
import {
  recordStatuses,
  snapshotStatuses,
  UserStatuses,
} from "./user-status.js";
import { getSlackArchiveData, setSlackArchiveData } from "./archive-data.js";
import { downloadAllEmoji, downloadEmojiList } from "./emoji.js";
import { downloadAllUsers, downloadAvatars } from "./users.js";
import { downloadChannels, downloadChannelMembers } from "./channels.js";
import { authTest } from "./web-client.js";
import { User, Channel, SlackArchiveChannelData } from "./interfaces.js";

const { prompt } = inquirer;

async function selectMergeFiles(): Promise<boolean> {
  const defaultResponse = true;

  if (!fs.existsSync(CHANNELS_DATA_PATH)) {
    return false;
  }

  // We didn't download any data. Merge.
  if (AUTOMATIC_MODE || NO_SLACK_CONNECT) {
    return defaultResponse;
  }

  const { merge } = await prompt([
    {
      type: "confirm",
      default: defaultResponse,
      name: "merge",
      message: `We've found existing archive files. Do you want to append new data (recommended)? \n If you select "No", we'll delete the existing data.`,
    },
  ]);

  if (!merge) {
    fs.emptyDirSync(OUT_DIR);
  }

  return merge;
}

async function selectChannels(
  channels: Array<Channel>,
  previouslyDownloadedChannels: Record<string, SlackArchiveChannelData>,
): Promise<Array<Channel>> {
  if (USE_PREVIOUS_CHANNEL_CONFIG) {
    const selectedChannels: Array<Channel> = channels.filter(
      (channel) => channel.id && channel.id in previouslyDownloadedChannels,
    );
    const selectedChannelNames = selectedChannels.map(
      (channel) => channel.name || channel.id || "Unknown",
    );
    console.log(
      `Downloading channels selected previously: ${selectedChannelNames}.`,
    );

    const previousChannelIds = Object.keys(previouslyDownloadedChannels);
    if (previousChannelIds.length != selectedChannels.length) {
      console.warn(
        "WARNING: Did not find all previously selected channel IDs.",
      );
      console.log(
        `Expected to find ${previousChannelIds.length} channels, but only ${selectedChannels.length} matched.`,
      );
      // Consider Looking up the user-facing names of the missing channels in the saved data.
      const availableChannelIds = new Set<string>(
        channels.map((channel) => channel.id || ""),
      );
      const missingChannelIds = previousChannelIds.filter(
        (cId) => !availableChannelIds.has(cId),
      );
      //console.log(availableChannelIds);
      console.log(`Missing channel ids: ${missingChannelIds}`);
    } else {
      console.log(
        `Matched all ${previousChannelIds.length} previously selected channels out of ${channels.length} total channels available.`,
      );
    }

    return selectedChannels;
  }

  const choices = channels.map((channel) => ({
    name: channel.name || channel.id || "Unknown",
    value: channel,
  }));

  if (AUTOMATIC_MODE || NO_SLACK_CONNECT) {
    if (EXCLUDE_CHANNELS) {
      const excludeChannels = EXCLUDE_CHANNELS.split(",");
      return channels.filter(
        (channel) => !excludeChannels.includes(channel.name || ""),
      );
    }
    return channels;
  }

  const result = await prompt([
    {
      type: "checkbox",
      loop: true,
      name: "channels",
      message: "Which channels do you want to download?",
      choices,
    },
  ]);

  return result.channels;
}

async function selectChannelTypes(): Promise<Array<string>> {
  const choices = [
    {
      name: "Public Channels",
      value: "public_channel",
    },
    {
      name: "Private Channels",
      value: "private_channel",
    },
    {
      name: "Multi-Person Direct Message",
      value: "mpim",
    },
    {
      name: "Direct Messages",
      value: "im",
    },
  ];

  if (CHANNEL_TYPES) {
    return CHANNEL_TYPES.split(",");
  }

  if (AUTOMATIC_MODE || USE_PREVIOUS_CHANNEL_CONFIG || NO_SLACK_CONNECT) {
    return ["public_channel", "private_channel", "mpim", "im"];
  }

  const result = await prompt([
    {
      type: "checkbox",
      loop: true,
      name: "channel-types",
      message: `Which channel types do you want to download?`,
      choices,
    },
  ]);

  return result["channel-types"];
}

async function getToken() {
  if (NO_SLACK_CONNECT) {
    return;
  }

  if (config.token) {
    console.log(`Using token ${config.token}`);
    return;
  }

  if (fs.existsSync(TOKEN_FILE)) {
    config.token = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
    return;
  }

  const result = await prompt([
    {
      name: "token",
      type: "input",
      message:
        "Please enter your Slack token (xoxp-...). See README for more details.",
    },
  ]);

  config.token = result.token;
}

/**
 * Every write of archived data goes through here.
 *
 * With --no-slack-connect nothing was fetched, so each of these files can only
 * be rewritten with what was just read out of it. The nightly render pass runs
 * that way over the same data directory as a different user and died twice on
 * EACCES writing a file it had no news for. Not writing is both the correct
 * behaviour and the only version that cannot fail on a permission.
 *
 * A flag would state it; this infers it from the one thing that decides it, so
 * there is nothing to set correctly at the call site.
 */
async function saveData(save: () => Promise<unknown>) {
  if (NO_SLACK_CONNECT) {
    return;
  }

  await save();
}

async function writeLastSuccessfulArchive() {
  // A render is not an archive. With --no-slack-connect nothing was fetched,
  // so stamping "last successful archive" would date an archive that did not
  // happen - and the publish render, which runs that way by design, would
  // rewrite the marker every time it produced a website from yesterday's data.
  if (NO_SLACK_CONNECT) {
    return;
  }

  const now = new Date();
  await write(DATE_FILE, now.toISOString());
}

function getLastSuccessfulRun() {
  if (!fs.existsSync(DATE_FILE)) {
    return "";
  }

  const lastSuccessfulArchive = fs.readFileSync(DATE_FILE, "utf-8");

  let date = null;

  try {
    date = parseISO(lastSuccessfulArchive);
  } catch (error) {
    return "";
  }

  if (date && isValid(date)) {
    return `. Last successful run: ${date.toLocaleString()}`;
  }

  return "";
}

async function getAuthTest() {
  if (NO_SLACK_CONNECT) {
    return;
  }

  const spinner = ora("Testing authentication with Slack...").start();
  const result = await authTest();

  if (!result.ok) {
    spinner.fail(`Authentication with Slack failed.`);

    console.log(
      `Authentication with Slack failed. The error was: ${result.error}`,
    );
    console.log(
      `The provided token was ${config.token}. Double-check the token and try again.`,
    );
    console.log(
      `For more information on the error code, see the error table at https://api.slack.com/methods/auth.test`,
    );
    console.log(`This tool will now exit.`);

    await deleteBackup();
    process.exit(-1);
  } else {
    spinner.succeed(`Successfully authorized with Slack as ${result.user}\n`);
  }

  return result;
}

export async function main() {
  console.log(`Welcome to slack-archive${getLastSuccessfulRun()}`);

  if (AUTOMATIC_MODE) {
    console.log(`Running in fully automatic mode without prompts`);
  }

  if (NO_SLACK_CONNECT) {
    console.log(`Not connecting to Slack and skipping all Slack API calls`);
  }

  await getToken();
  await createBackup();

  const slackArchiveData = await getSlackArchiveData();
  const users: Record<string, User> = await getUsers();
  const channelTypes = (await selectChannelTypes()).join(",");

  slackArchiveData.auth = await getAuthTest();

  // Everybody, not only whoever posted. See downloadAllUsers.
  if (!NO_SLACK_CONNECT) {
    await downloadAllUsers(users);
  }

  // What people are called today. Slack keeps no rename history, so a run that
  // does not write this down is a year of nicknames nobody can recover later.
  let userNames = recordNames(
    await getUserNames(),
    snapshotNames(users, new Date().toISOString()),
  );
  let userAvatars: UserAvatars = await getUserAvatars();

  // Statuses have no retroactive source at all - a status is never quoted in a
  // message - so today's snapshot is the only record that will ever exist of
  // today.
  const userStatuses: UserStatuses = recordStatuses(
    await getUserStatuses(),
    snapshotStatuses(users, new Date().toISOString()),
  );

  const channels = await downloadChannels({ types: channelTypes }, users);

  // Who is in each conversation, which nothing has ever recorded and which
  // cannot be asked about the past.
  await downloadChannelMembers(channels);
  const selectedChannels = await selectChannels(
    channels,
    slackArchiveData.channels,
  );
  const newMessages: Record<string, number> = {};

  // Emoji: the list, then every image in it, once.
  const emojis = await downloadEmojiList();

  // A run that could not ask Slack has learned nothing, and rewriting the file
  // with nothing needs write access this run may not have: the nightly render
  // pass, which runs --no-slack-connect over the same data directory as a
  // different user, died twice on EACCES here without touching a byte of new
  // information.
  if (Object.keys(emojis).length > 0) {
    await saveData(() => writeAndMerge(EMOJIS_DATA_PATH, emojis));
  }

  await downloadAllEmoji(emojis);

  // Do we want to merge data?
  await selectMergeFiles();
  await saveData(() => writeAndMerge(CHANNELS_DATA_PATH, selectedChannels));

  // Download messages and extras for each channel
  await downloadEachChannel();

  // Then mine the nicknames out of them
  await recordUserNames();

  // Save data
  await saveData(() => setSlackArchiveData(slackArchiveData));

  // Create HTML, but only for channels with new messages
  // - or channels that we didn't make HTML for yet
  const channelsToCreateFilesFor = await getChannelsToCreateFilesFor(
    selectedChannels,
    newMessages,
  );
  await createHtmlForChannels(channelsToCreateFilesFor);

  // Create search file
  await createSearch();

  // Cleanup and finalize
  await deleteBackup();
  await deleteOlderBackups();
  await writeLastSuccessfulArchive();

  console.log(`All done.`);

  /**
   * Write down what everyone has ever been called.
   *
   * Old mentions carry the name as it was that day - <@U2H06BCQZ|jaricurry> -
   * and that is the only retroactive record of a past nickname that exists;
   * Slack itself keeps none. This runs over every selected channel rather than
   * inside the download loop, because a channel marked fullyDownloaded is
   * skipped there, and an archived channel is exactly where the oldest names
   * are. getMessages serves the cache for what was just downloaded and reads
   * the rest from disk.
   */
  async function recordUserNames() {
    const spinner = ora(`Recording nicknames...`).start();

    for (const channel of selectedChannels) {
      if (!channel.id) continue;

      spinner.text = `Recording nicknames from ${channel.name || channel.id}`;
      spinner.render();

      for (const message of await getMessages(channel.id, true)) {
        userNames = recordNames(userNames, mineNames(message));
        userAvatars = recordAvatars(userAvatars, mineAvatars(message));
      }
    }

    await saveData(() =>
      write(USER_NAMES_DATA_PATH, JSON.stringify(userNames, undefined, 2)),
    );
    await saveData(() =>
      write(USER_AVATARS_DATA_PATH, JSON.stringify(userAvatars, undefined, 2)),
    );
    await saveData(() =>
      write(USER_STATUS_DATA_PATH, JSON.stringify(userStatuses, undefined, 2)),
    );

    const nicks = Object.values(userNames).reduce(
      (total, names) => total + names.length,
      0,
    );
    const faces = Object.values(userAvatars).reduce(
      (total, avatars) => total + avatars.length,
      0,
    );

    spinner.succeed(
      `Recorded ${nicks} names and ${faces} faces for ${
        Object.keys(userNames).length
      } users.`,
    );

    await downloadAvatarHistory();
  }

  /**
   * Fetch the past profile pictures themselves.
   *
   * The URLs stay valid on Slack's CDN for now, which is exactly why they
   * should not be relied on: an archive that renders somebody's 2017 face by
   * hot-linking Slack is an archive of a link, not of a face. They are small,
   * public, and there are a couple of hundred of them.
   */
  async function downloadAvatarHistory() {
    const pending = pendingAvatars(userAvatars);
    const known = Object.values(userAvatars).reduce(
      (total, avatars) => total + avatars.length,
      0,
    );
    if (known === 0 || NO_FILE_DOWNLOAD) return;

    const spinner = ora("Downloading past profile pictures...").start();
    let attempted = 0;
    let stored = 0;
    let already = 0;
    let refused = 0;
    let failed = 0;

    for (const { userId, avatar } of pending) {
      const extension = path.extname(new URL(avatar.url).pathname) || ".jpg";
      const filePath = getAvatarHistoryFilePath(userId, avatar.date, extension);

      if (fs.existsSync(filePath)) {
        already++;
        continue;
      }

      attempted++;
      spinner.text = `Downloading past profile pictures (${attempted})`;
      spinner.render();

      const outcome = await downloadURL(avatar.url, filePath, {
        authorize: false,
      });

      // Asked for, and arrived, are different numbers: Slack has retired a
      // third of the older URLs. Counting attempts would report 212 downloads
      // for 141 files, which is the same lie as a wrapper logging OK for a run
      // that did nothing.
      if (outcome === "stored") {
        stored++;
      } else if (outcome === "refused") {
        // Settled, not transient. Recording it stops 71 requests a night
        // asking a question that has already been answered.
        refused++;
        userAvatars = markRefused(
          userAvatars,
          userId,
          avatar.date,
          new Date().toISOString(),
        );
      } else {
        failed++;
      }
    }

    const skipped = known - pending.length;

    spinner.succeed(
      `Past profile pictures: ${stored} downloaded, ${refused} refused by Slack, ` +
        `${failed} failed, ${already} already here, ${skipped} known-gone and not asked for.`,
    );

    // The refusals recorded above have to reach disk, or the next run asks
    // again and learns the same thing.
    await write(
      USER_AVATARS_DATA_PATH,
      JSON.stringify(userAvatars, undefined, 2),
    );
  }

  async function downloadEachChannel() {
    if (NO_SLACK_CONNECT) return;

    for (const [i, channel] of selectedChannels.entries()) {
      if (!channel.id) {
        console.warn(`Selected channel does not have an id`, channel);
        continue;
      }

      // Do we already have everything?
      slackArchiveData.channels[channel.id] =
        slackArchiveData.channels[channel.id] || {};
      if (slackArchiveData.channels[channel.id].fullyDownloaded) {
        continue;
      }

      // Download messages & users
      let downloadData = await downloadMessages(
        channel,
        i,
        selectedChannels.length,
      );
      let result = downloadData.messages;
      newMessages[channel.id] = downloadData.new;

      await downloadExtras(channel, result, users);
      await downloadAvatars();

      // Sort messages
      const spinner = ora(
        `Saving message data for ${channel.name || channel.id} to disk`,
      ).start();
      spinner.render();

      result = uniqBy(result, "ts");
      result = result.sort((a, b) => {
        return parseFloat(b.ts || "0") - parseFloat(a.ts || "0");
      });

      await saveData(() => writeAndMerge(USERS_DATA_PATH, users));
      await saveData(() =>
        writeJsonArray(getChannelDataFilePath(channel.id!), result),
      );

      // Download files. This needs to run after the messages are saved to disk
      // since it uses the message data to find which files to download.
      await downloadFilesForChannel(channel.id!, spinner);

      // Update the data load cache
      messagesCache[channel.id!] = result;

      // Update the data
      const { is_archived, is_im, is_user_deleted } = channel;
      if (is_archived || (is_im && is_user_deleted)) {
        slackArchiveData.channels[channel.id].fullyDownloaded = true;
      }
      slackArchiveData.channels[channel.id].messages = result.length;

      spinner.succeed(`Saved message data for ${channel.name || channel.id}`);
    }
  }
}

main();
