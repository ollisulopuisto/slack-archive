import { App } from "@slack/bolt";
import sqlite3 from "sqlite3";
import fs from "fs-extra";
import { SEARCH_DB_PATH } from "./config.js";
import { filterResultsByPhrases, parseSearchQuery } from "./search-query.js";

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

  const db = new sqlite3.Database(SEARCH_DB_PATH);
  console.log("Database connection established.");

  db.get("SELECT COUNT(*) AS count FROM messages", (err, row: any) => {
    if (err) {
      console.error("Error checking messages count:", err.message);
    } else {
      console.log(`Database stats: ${row ? row.count : 0} messages in index.`);
    }
  });

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

    const { cleanQuery, phrases } = parseSearchQuery(query);

    let results: any[] = [];
    if (cleanQuery) {
      const ftsQuery = cleanQuery
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => `${word}*`)
        .join(" AND ");

      if (ftsQuery) {
        results = await new Promise<any[]>((resolve) => {
          db.all(
            `SELECT 
              m.timestamp AS t, 
              m.user_id AS u, 
              m.message AS m, 
              m.channel_id AS c,
              c_tbl.name AS channelName,
              u_tbl.name AS userName
            FROM messages m
            JOIN messages_fts fts ON m.id = fts.id
            LEFT JOIN channels c_tbl ON m.channel_id = c_tbl.id
            LEFT JOIN users u_tbl ON m.user_id = u_tbl.id
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT 100`,
            [ftsQuery],
            (err, rows) => {
              if (err) {
                console.error("Database search error:", err);
                resolve([]);
              } else {
                resolve(rows || []);
              }
            },
          );
        });
      }
    }

    results = filterResultsByPhrases(results, phrases);

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
