// Symlink only the channels this site publishes into the staging tree.
//
// The renderer already refuses to write pages for the rest and the upload
// already excludes data/ - but that is two layers of "do not show it" over a
// directory holding ten years of somebody's direct messages, and the checks
// that run before upload inspect the rendered HTML, not this. A file that was
// never staged cannot be sent by a wrong rsync line.
//
// In node rather than python because the image that runs this has node and
// does not have python - a script that works on the machine it was written on
// is not a script that works.
import fs from "fs";
import path from "path";

const [archive, dest] = process.argv.slice(2);
const channels = JSON.parse(
  fs.readFileSync(path.join(archive, "data", "channels.json"), "utf8"),
);

function kind(channel) {
  if (channel.is_im) return "im";
  if (channel.is_mpim) return "mpim";
  if (channel.is_private) return "private";
  return "public";
}

let staged = 0;
let withheld = 0;

for (const channel of channels) {
  const id = channel?.id;

  if (!id) continue;

  const source = path.join(archive, "data", `${id}.json`);

  if (!fs.existsSync(source)) continue;

  if (kind(channel) !== "public") {
    withheld++;
    continue;
  }

  fs.symlinkSync(source, path.join(dest, `${id}.json`));
  staged++;
}

console.log(
  `  ${staged} public channels staged, ${withheld} withheld (im, mpim, private)`,
);
