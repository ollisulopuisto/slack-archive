// Six checks between the render and the upload. Any one of them stops it.
//
// In node rather than python because the image that runs this has node and no
// python, and a check that cannot run is not a check.
import fs from "fs";
import path from "path";

const dir = process.argv[2];
const read = (file) => fs.readFileSync(path.join(dir, file), "utf8");
const channels = JSON.parse(read("data/channels.json"));
const html = fs.readdirSync(path.join(dir, "html"));

function kind(channel) {
  if (channel.is_im) return "im";
  if (channel.is_mpim) return "mpim";
  if (channel.is_private) return "private";
  return "public";
}

function pagesOf(id) {
  return html.filter(
    (name) => name.startsWith(`${id}-`) || name === `channel-${id}.html`,
  );
}

const fail = [];

// 1. nothing non-public rendered. By KIND, not by id prefix: Slack gives newer
//    group DMs C-ids, so a prefix test misses fourteen of them here.
const leaked = channels
  .filter((c) => c.id && kind(c) !== "public" && pagesOf(c.id).length > 0)
  .map((c) => c.id);
if (leaked.length) {
  fail.push(`non-public channels with pages: ${leaked.slice(0, 5).join(", ")}`);
}

// 2. nothing public missing. Catches a render that stopped halfway, which both
//    leak checks would happily pass.
const absent = channels
  .filter((c) => c.id && kind(c) === "public" && pagesOf(c.id).length === 0)
  .map((c) => c.name);
if (absent.length) {
  fail.push(`public channels with no pages: ${absent.slice(0, 5).join(", ")}`);
}

// 3. an independent check of the same question, by content rather than by id.
const groupNamed = html.filter(
  (name) =>
    name.endsWith(".html") &&
    read(path.join("html", name)).includes("Group messaging with"),
);
if (groupNamed.length) {
  fail.push(`'Group messaging with' in ${groupNamed.length} files`);
}

// 4. the search index the site serves is a DATABASE now, and the browser reads
//    it directly - so anything in it is published, including the names of
//    channels it holds no messages for. It is checked against the channels
//    this SITE publishes, taken from channels.json by kind, never against the
//    database's own idea of what is public: that is the thing being checked.
//
//    A binary artefact is not edited in place here the way search.js was. If
//    this fails, the render was told the wrong exclusions and the fix is to
//    build it again, not to carve rows out of a file nobody can eyeball.
const publicIds = new Set(
  channels.filter((c) => c.id && kind(c) === "public").map((c) => c.id),
);
const dbPath = path.join(dir, "data/search.db");

if (!fs.existsSync(dbPath)) {
  fail.push("no data/search.db: the site's search page has nothing to read");
} else {
  const { openSearchDatabase } = await import("../lib/search-db.js");
  const db = openSearchDatabase(dbPath);

  try {
    const strayChannels = db
      .all("select id, name from channels")
      .filter((row) => !publicIds.has(row.id));

    if (strayChannels.length) {
      fail.push(
        `non-public channels in search.db: ${strayChannels
          .slice(0, 5)
          .map((row) => row.name || row.id)
          .join(", ")}`,
      );
    }

    const strayMessages = db.all(
      `select channel_id, count(*) n from messages
        where channel_id not in (select id from channels) group by channel_id`,
    );

    if (strayMessages.length) {
      fail.push(
        `messages in search.db from channels it does not list: ${strayMessages
          .map((row) => `${row.channel_id} (${row.n})`)
          .join(", ")}`,
      );
    }

    // 5. the index has to be able to answer. An empty full-text table is a
    //    search page that opens, accepts a query and finds nothing, forever -
    //    which looks like an archive with nothing in it rather than a broken
    //    build.
    const [{ n: messages }] = db.all("select count(*) n from messages");
    const [{ n: indexed }] = db.all("select count(*) n from messages_fts");

    if (messages === 0) fail.push("search.db holds no messages");
    if (indexed !== messages) {
      fail.push(
        `search.db full-text index is incomplete: ${indexed} rows for ${messages} messages`,
      );
    }

    // The browser fetches whole pages over HTTP range requests, so the page
    // size is part of the interface: at 4096 every read drags in four times
    // what it needs.
    const [{ page_size: pageSize }] = db.all("pragma page_size");
    if (pageSize !== 1024) {
      fail.push(`search.db page size is ${pageSize}, not 1024`);
    }

    const [{ n: pages }] = db.all("select count(*) n from pages");
    if (pages === 0) {
      fail.push(
        "search.db has no page index, so every result would link to page 0",
      );
    }
  } finally {
    db.close();
  }
}

// 5b. nothing in the rendered HTML still carries a template placeholder. One
//     shipped for weeks: the front page's redirect for old permalinks sent
//     readers to /${base}C123-4.html, and every link pasted before the archive
//     had per-page URLs 404ed.
const unexpanded = html
  .filter((name) => name.endsWith(".html"))
  .filter((name) => read(path.join("html", name)).includes("${base}"))
  .slice(0, 5);

if (unexpanded.length || read("index.html").includes("${base}")) {
  fail.push(
    `unexpanded \${base} in ${unexpanded.length ? unexpanded.join(", ") : "index.html"}`,
  );
}

// 6. no run-state or dotfiles in a published tree.
const dotfiles = fs
  .readdirSync(dir)
  .filter(
    (name) =>
      name.startsWith(".") && fs.statSync(path.join(dir, name)).isFile(),
  );
if (dotfiles.length) fail.push(`dotfiles: ${dotfiles.join(", ")}`);

if (fail.length) {
  console.log("\n  REFUSING TO PUBLISH:");
  for (const reason of fail) console.log(`    - ${reason}`);
  process.exit(1);
}

console.log(
  `  all six pass - ${html.filter((n) => n.endsWith(".html")).length} pages`,
);
