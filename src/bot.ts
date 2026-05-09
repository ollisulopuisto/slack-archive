import { App } from "@slack/bolt";
import MiniSearch from "minisearch";
import { getSearchFile } from "./data-load.js";
import { SearchMessage } from "./interfaces.js";

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

  console.log("Loading archive data for bot...");
  const searchData = await getSearchFile();

  const miniSearch = new MiniSearch({
    idField: "t",
    fields: ["m"],
    storeFields: ["t", "u", "m", "c"],
  });

  let messageCount = 0;
  for (const channelId in searchData.messages) {
    const messages = searchData.messages[channelId].map((msg) => ({
      ...msg,
      c: channelId,
    }));
    miniSearch.addAll(messages);
    messageCount += messages.length;
  }

  console.log(`Indexing ${messageCount} messages...`);
  console.log("Indexing complete.");

  app.event("app_mention", async ({ event, say }: { event: any; say: any }) => {
    const text = event.text;
    // Remove the mention from the query
    const query = text.replace(/<@[A-Z0-9]+>/g, "").trim();
    const query = text.replace(/<@[A-Z0-9]+[^>]*>/g, "").trim();
    if (!query) {
      await say(
        'Mitä haluaisit etsiä arkistosta? Esimerkki: `@arkisto intel` tai `@arkisto "tämä fraasi"`',
      );
      return;
    }

    console.log(`Bot search query: ${query}`);

    // Phrase search logic
    const phrases: string[] = [];
    const regex = /"([^"]+)"/g;
    let match;
    while ((match = regex.exec(query)) !== null) {
      phrases.push(match[1]);
    }

    const cleanQuery = query.replace(/"/g, " ").trim();

    let results: any[] = [];
    if (cleanQuery) {
      results = miniSearch.search(cleanQuery, {
        combineWith: "AND",
        prefix: true,
      });
    }

    if (phrases.length > 0) {
      results = results.filter((result) => {
        const msgText = result.m.toLowerCase();
        return phrases.every((phrase) =>
          msgText.includes(phrase.toLowerCase()),
        );
      });
    }

    const topResults = results.slice(0, 5);

    if (topResults.length === 0) {
      await say(`Ei osumia haulla: ${query}`);
      return;
    }

    let response = `Löytyi ${results.length} osumaa. Tässä top ${topResults.length}:\n\n`;

    for (const res of topResults) {
      const channelName = searchData.channels[res.c] || res.c;
      const userName = searchData.users[res.u] || res.u;
      const date = new Date(parseFloat(res.t) * 1000).toLocaleString();

      response += `*#${channelName}* | *${userName}* | ${date}\n> ${res.m}\n\n`;
    }

    await say({
      text: response,
      thread_ts: event.ts,
    });
  });

  await app.start();
  console.log("⚡️ Slack archive bot is running with Socket Mode!");
}
