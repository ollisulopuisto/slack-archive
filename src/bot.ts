import { App } from "@slack/bolt";
import fs from "fs-extra";
import { SEARCH_DB_PATH } from "./config.js";
import {
  countMessages,
  openSearchDatabase,
  searchDatabase,
} from "./search-db.js";

export async function runBot() {
  const token = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!token || !appToken) {
    console.error(
      "Error: SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set to run the bot.",
    );
    console.log(
      "Ensure you have a Slack App with Socket Mode enabled and the following scopes:",
    );
    console.log("- app_mentions:read");
    console.log("- chat:write");
    process.exit(1);
  }

  const app = new App({
    token: token,
    appToken: appToken,
    socketMode: true,
  });

  console.log("Opening search database for bot...");
  if (!fs.existsSync(SEARCH_DB_PATH)) {
    console.error(`Error: Search database file not found at ${SEARCH_DB_PATH}`);
    console.error("Please run archiving or build the search database first.");
    process.exit(1);
  }

  const db = openSearchDatabase(SEARCH_DB_PATH);
  console.log("Database connection established.");

  try {
    console.log(`Database stats: ${countMessages(db)} messages in index.`);
  } catch (error) {
    console.error("Error checking messages count:", error);
  }

  // Log all incoming payloads for debugging
  app.use(async ({ payload, next }) => {
    console.log("Slack event payload received:", JSON.stringify(payload));
    await next();
  });

  async function performSearch(text: string, say: any, threadTs?: string) {
    // Remove the mention from the query
    const query = text.replace(/<@[A-Z0-9]+[^>]*>/g, "").trim();
    if (!query) {
      await say({
        text: 'Mitä haluaisit etsiä arkistosta? Esimerkki: `intel` tai `"tämä fraasi"`',
        thread_ts: threadTs,
      });
      return;
    }

    console.log(`Bot search query: ${query}`);

    const results = searchDatabase(db, query);

    const topResults = DefenseSlice(results, 5);

    if (topResults.length === 0) {
      await say({
        text: `Ei osumia haulla: ${query}`,
        thread_ts: threadTs,
      });
      return;
    }

    let response = `Löytyi ${results.length} osumaa. Tässä top ${topResults.length}:\n\n`;

    for (const res of topResults) {
      const channelName = res.channelName || res.c;
      const userName = res.userName || res.u;
      const date = new Date(parseFloat(res.t) * 1000).toLocaleString("fi-FI");
      const message = typeof res.m === "string" ? res.m : "";

      response += `*#${channelName}* | *${userName}* | ${date}\n> ${message.replace(/\n/g, "\n> ")}\n\n`;
    }

    await say({
      text: response,
      thread_ts: threadTs,
    });
  }

  app.event("app_mention", async ({ event, say }: { event: any; say: any }) => {
    await performSearch(event.text, say, event.ts);
  });

  app.event("message", async ({ event, say }: { event: any; say: any }) => {
    // Only respond to direct messages (IMs) sent by users (ignore bot messages and other channel messages)
    if (event.channel_type === "im" && !event.bot_id && event.user) {
      await performSearch(event.text, say);
    }
  });

  await app.start();
  console.log("⚡️ Slack archive bot is running with Socket Mode!");
}

function DefenseSlice<T>(arr: T[], limit: number): T[] {
  return arr.slice(0, limit);
}
