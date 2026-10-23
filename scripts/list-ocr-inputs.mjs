// Print the files in data/ that reading the pictures needs, one per line,
// relative to data/: channels.json, and the message file of every channel whose
// pictures may be read.
//
// The machine that reads the pictures needs to know which picture belongs to
// which channel - and whether that channel may be read at all - and that is
// all in these files. It does not need the rest of data/, and above all it does
// not need the direct messages, so they are not listed and not sent.
//
// The rule is isOcrAllowedKind in src/ocr.ts: public and private channels, and
// nothing else. A channel whose kind cannot be told is not listed either. The
// two are kept in step by a test that runs this against every kind.
//
// In node rather than shell because the image that runs this has node and no
// jq, and the NAS has neither.
import fs from "fs";
import path from "path";

const [archive] = process.argv.slice(2);

if (!archive) {
  console.error("usage: list-ocr-inputs.mjs <archive-directory>");
  process.exit(2);
}

const channels = JSON.parse(
  fs.readFileSync(path.join(archive, "data", "channels.json"), "utf8"),
);

function kind(channel) {
  if (channel.is_im) return "im";
  if (channel.is_mpim) return "mpim";
  if (channel.is_private) return "private";
  return "public";
}

const lines = ["channels.json"];

for (const channel of channels) {
  const id = channel?.id;

  if (!id) continue;
  if (kind(channel) !== "public" && kind(channel) !== "private") continue;

  const file = `${id}.json`;

  if (fs.existsSync(path.join(archive, "data", file))) lines.push(file);
}

process.stdout.write(`${lines.join("\n")}\n`);
