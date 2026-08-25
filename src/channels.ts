import {
  ConversationsListArguments,
  ConversationsListResponse,
} from "@slack/web-api";
import ora from "ora";
import { NO_SLACK_CONNECT } from "./config.js";

import { Channel, ChannelKind, Users } from "./interfaces.js";
import { downloadUser, getName } from "./users.js";
import { getWebClient } from "./web-client.js";

export function getChannelName(channel: Channel) {
  return (
    channel.name || channel.id || channel.purpose?.value || "Unknown channel"
  );
}

/**
 * Resolve a conversation to exactly one kind.
 *
 * The order is the whole point. Slack sets `is_private: true` on direct
 * messages and group DMs as well as on private channels, so asking "is it
 * private?" first labels every DM in the archive a private channel - and a
 * reader gating on that would hand out direct messages to anyone who could see
 * any private channel. DMs are settled first, then group DMs, and `private`
 * only gets what is left.
 */
export function channelKind(channel: Channel): ChannelKind {
  if (channel.is_im) return "im";
  if (channel.is_mpim) return "mpim";
  if (channel.is_private) return "private";
  return "public";
}

export function isPublicChannel(channel: Channel) {
  return !channel.is_private && !channel.is_mpim && !channel.is_im;
}

export function isPrivateChannel(channel: Channel) {
  return channel.is_private && !channel.is_im && !channel.is_mpim;
}

export function isDmChannel(channel: Channel, users: Users) {
  return channel.is_im && channel.user && !users[channel.user]?.is_bot;
}

export function isBotChannel(channel: Channel, users: Users) {
  return channel.user && users[channel.user]?.is_bot;
}

function isChannels(input: any): input is ConversationsListResponse {
  return !!input.channels;
}

export async function downloadChannels(
  options: ConversationsListArguments,
  users: Users,
): Promise<Array<Channel>> {
  const channels: Array<Channel> = [];

  if (NO_SLACK_CONNECT) {
    return channels;
  }

  const spinner = ora("Downloading channels").start();

  for await (const page of getWebClient().paginate(
    "conversations.list",
    options as any,
  )) {
    if (isChannels(page)) {
      spinner.text = `Found ${page.channels?.length} channels (found so far: ${
        channels.length + (page.channels?.length || 0)
      })`;

      const pageChannels = (page.channels || []).filter(
        (c) => !!c.id,
      ) as Channel[];

      for (const channel of pageChannels) {
        if (channel.is_im) {
          const user = await downloadUser(channel, users);
          channel.name =
            channel.name || `${getName(user?.id, users)} (${user?.name})`;
        }

        if (channel.is_mpim) {
          channel.name = (channel as any).purpose?.value;
        }
      }

      channels.push(...pageChannels);
    }
  }

  spinner.succeed(`Found ${channels.length} channels`);

  return channels;
}
