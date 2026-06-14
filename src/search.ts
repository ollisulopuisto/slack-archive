import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import ora, { Ora } from "ora";
import { getChannelName } from "./channels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  NO_SEARCH,
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
  getUsers,
} from "./data-load.js";
import sqlite3 from "sqlite3";

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

async function createSearchDatabase(spinner: Ora) {
  const users = await getUsers();
  const channels = await getChannels();

  // Delete existing database file to start fresh and avoid locks
  if (fs.existsSync(SEARCH_DB_PATH)) {
    fs.unlinkSync(SEARCH_DB_PATH);
  }

  const db = new sqlite3.Database(SEARCH_DB_PATH);

  await new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      
      // Create tables
      db.run("CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT)");
      db.run("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)");
      db.run(`CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT,
        user_id TEXT,
        timestamp TEXT,
        message TEXT
      )`);
      db.run("CREATE VIRTUAL TABLE messages_fts USING fts5(id UNINDEXED, message)");

      // Begin transaction
      db.run("BEGIN TRANSACTION");

      // Insert Users
      const userStmt = db.prepare("INSERT OR REPLACE INTO users (id, name) VALUES (?, ?)");
      for (const userId in users) {
        const name = users[userId].name || users[userId].real_name || "Unknown";
        userStmt.run(userId, name);
      }
      userStmt.finalize();

      resolve();
    });
  });

  // Now insert the messages in batches
  for (const channel of channels) {
    if (!channel.id) continue;
    const name = getChannelName(channel);
    
    spinner.text = `Indexing database messages for channel ${name}`;
    spinner.render();

    await new Promise<void>((resolve, reject) => {
      db.serialize(async () => {
        db.run("INSERT OR REPLACE INTO channels (id, name) VALUES (?, ?)", channel.id, name);
        
        const messages = await getMessages(channel.id!, true);
        const msgStmt = db.prepare("INSERT OR REPLACE INTO messages (id, channel_id, user_id, timestamp, message) VALUES (?, ?, ?, ?, ?)");
        const ftsStmt = db.prepare("INSERT OR REPLACE INTO messages_fts (id, message) VALUES (?, ?)");
        
        for (const msg of messages) {
          const id = `${channel.id}-${msg.ts}`;
          const text = msg.text || "";
          msgStmt.run(id, channel.id, msg.user, msg.ts, text);
          ftsStmt.run(id, text);
        }
        
        msgStmt.finalize();
        ftsStmt.finalize();
        resolve();
      });
    });
  }

  // Commit transaction and close
  await new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      db.run("COMMIT", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function createSearchFile(spinner: Ora) {
  const existingData = await getSearchFile();
  const users = await getUsers();
  const channels = await getChannels();
  const result: SearchFile = {
    channels: {},
    users: {},
    messages: {},
    pages: { ...existingData.pages, ...INDEX_OF_PAGES },
  };

  // Users
  for (const user in users) {
    result.users[user] = users[user].name || users[user].real_name || "Unknown";
  }

  // Channels & Messages
  for (const [i, channel] of channels.entries()) {
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

    const messages = (await getMessages(channel.id, true)).map((message) => {
      const searchMessage: SearchMessage = {
        m: message.text,
        u: message.user,
        t: message.ts,
      };

      return searchMessage;
    });

    result.messages![channel.id] = messages;
    result.channels[channel.id] = name;
  }

  const jsContent = `window.search_data = ${JSON.stringify(result)};`;
  await fs.outputFile(SEARCH_DATA_PATH, jsContent);
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
