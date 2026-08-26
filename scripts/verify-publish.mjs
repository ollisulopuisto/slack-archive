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

// 4. search.js is built for BOTH the bot and the website, from one flag, so it
//    holds whatever the bot may see - which includes private channels by
//    Olli's decision. The website may not. It is filtered against the channels
//    this SITE publishes, taken from channels.json by kind, never against
//    search.js's own channel map: that map is the thing being checked.
const raw = read("data/search.js");
const data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const publicIds = new Set(
  channels.filter((c) => c.id && kind(c) === "public").map((c) => c.id),
);
const removed = {};

for (const key of ["channels", "messages", "pages"]) {
  const held = data[key] || {};
  const stray = Object.keys(held).filter((id) => !publicIds.has(id));

  if (stray.length) {
    removed[key] = stray.length;
    for (const id of stray) delete held[id];
  }
}

if (Object.keys(removed).length) {
  fs.writeFileSync(
    path.join(dir, "data/search.js"),
    raw.slice(0, raw.indexOf("{")) + JSON.stringify(data) + ";\n",
  );
  console.log(
    `  search.js: removed non-public entries ${JSON.stringify(removed)}`,
  );
}

// 5. the search page must be able to start. MiniSearch throws on a duplicate
//    id, and one throw in componentDidMount is the whole search page - a file
//    carrying two rows with one timestamp is a broken site, not a slightly
//    worse index. It was broken for weeks without anything saying so.
let duplicates = 0;
let channelsWithDuplicates = 0;

for (const messages of Object.values(data.messages || {})) {
  const seen = new Set();
  let here = 0;

  for (const message of messages) {
    if (seen.has(message.t)) here++;
    seen.add(message.t);
  }

  if (here) {
    duplicates += here;
    channelsWithDuplicates++;
  }
}

if (duplicates) {
  fail.push(
    `duplicate message ids in search.js: ${duplicates} in ${channelsWithDuplicates} channels`,
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
