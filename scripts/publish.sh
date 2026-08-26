#!/bin/bash
#
# publish.sh - render the PUBLIC half of an archive and put it on a web host.
#
# This is the whole of what makes a private archive publishable, and it lives
# in the repository rather than on one machine because there were two copies of
# it - one on a laptop and one on the NAS - and they drifted. Both grew the
# same blind spot: every check read the rendered HTML, neither read the data
# directory, and the data directory was where ten years of direct messages sat,
# one rsync flag away from a web root.
#
# It refuses to publish rather than publish something wrong. Seven checks run
# between the render and the upload, any one of them stops it, and the last one
# reads the WEB ROOT ITSELF rather than the tree we built - because the tree we
# built is the thing that might be wrong.
#
# Usage:
#   scripts/publish.sh --archive PATH --site USER@HOST:/PATH [options]
#
#   --archive PATH        the slack-archive directory (holding data/ and html/)
#   --site DEST           rsync destination for the web root
#   --exclude-kinds LIST  channel kinds never rendered (default: im,mpim,private)
#   --start-channel NAME  what the front page offers to open (default: the
#                         busiest one)
#   --exclude-user-files LIST  whose attachments were never downloaded, so the
#                         pages say so instead of linking a file that is not
#                         there
#   --work PATH           scratch directory (default: $TMPDIR/archive-publish)
#   --node CMD            how to run node (default: node)
#   --ssh-key PATH        identity for rsync and the web-root check
#   --known-hosts PATH    host keys to trust (a container has no home to
#                         keep them in, and an unverified host is not a host)
#   --repo PATH           this repository (default: the parent of this script)
#   --dry-run             render and check, upload nothing
#
# Nothing here is specific to one workspace: pass the paths in.

set -euo pipefail

ARCHIVE=""
SITE=""
EXCLUDE_KINDS="im,mpim,private"
START_CHANNEL=""
EXCLUDE_USER_FILES=""
WORK="${TMPDIR:-/tmp}/archive-publish"
NODE="node"
SSH_KEY=""
KNOWN_HOSTS=""
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --archive) ARCHIVE="$2"; shift 2 ;;
    --site) SITE="$2"; shift 2 ;;
    --exclude-kinds) EXCLUDE_KINDS="$2"; shift 2 ;;
    --start-channel) START_CHANNEL="$2"; shift 2 ;;
    --exclude-user-files) EXCLUDE_USER_FILES="$2"; shift 2 ;;
    --work) WORK="$2"; shift 2 ;;
    --node) NODE="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --known-hosts) KNOWN_HOSTS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -n "$ARCHIVE" ] || { echo "--archive is required" >&2; exit 2; }
[ -n "$SITE" ] || [ "$DRY_RUN" = "1" ] || { echo "--site is required unless --dry-run" >&2; exit 2; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

# Two of these at once share a scratch tree and destroy each other's render -
# which is what a nightly run and somebody's manual run look like on the same
# machine. mkdir is atomic; a lock FILE's existence would only prove that a
# lock file exists, which is a lesson this project has already paid for.
#
# The lock lives inside the work directory, not beside it: beside it means
# creating a directory in whatever the parent happens to be, and in a container
# that is often "/" owned by root while the process is not. The first version
# of this reported "another publish is already using it" for what was actually
# a permission error - a specific cause invented for a generic failure.
mkdir -p "$WORK" || { echo "Cannot create $WORK" >&2; exit 1; }
LOCK="$WORK/.publish-lock"

if [ -d "$LOCK" ]; then
  echo "Another publish is already using $WORK." >&2
  echo "Wait for it to finish, or pass a different --work." >&2
  echo "If nothing is running, remove $LOCK." >&2
  exit 1
fi

if ! mkdir "$LOCK"; then
  echo "Cannot lock $WORK - see the error above." >&2
  exit 1
fi

trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

say "1/7  checking the archive"
[ -d "$ARCHIVE/data" ] || { echo "No data directory in $ARCHIVE" >&2; exit 1; }
echo "  $(ls "$ARCHIVE/data"/[CDG]*.json 2>/dev/null | wc -l | tr -d ' ') channel files"

say "2/7  staging"
# Metadata is COPIED so the renderer cannot write back into the archive - it
# rewrites slack-archive.json on every run. Message files are symlinked because
# they are 1.5 GB and only read.
# The work directory itself survives: it holds the lock this run is using.
rm -rf "$WORK/slack-archive"; mkdir -p "$WORK/slack-archive/data"
for f in channels.json users.json slack-archive.json emojis.json \
         user-names.json user-avatars.json user-status.json; do
  cp "$ARCHIVE/data/$f" "$WORK/slack-archive/data/$f" 2>/dev/null || true
done
# ONLY the channels this site publishes. The renderer already refuses to write
# pages for the rest, and the upload already excludes data/ - but that is two
# layers of "don't show it" over a directory that still contains ten years of
# Olli's direct messages, and the six checks below inspect the rendered HTML,
# not this. A file that was never staged cannot be sent by a wrong rsync line.
python3 - "$ARCHIVE" "$WORK/slack-archive/data" <<'STAGE'
import json, os, sys

archive, dest = sys.argv[1], sys.argv[2]
channels = json.load(open(os.path.join(archive, "data", "channels.json")))

def kind(c):
    if c.get("is_im"): return "im"
    if c.get("is_mpim"): return "mpim"
    if c.get("is_private"): return "private"
    return "public"

staged = withheld = 0
for c in channels:
    cid = c.get("id")
    if not cid: continue
    source = os.path.join(archive, "data", f"{cid}.json")
    if not os.path.exists(source): continue
    if kind(c) != "public":
        withheld += 1
        continue
    os.symlink(source, os.path.join(dest, f"{cid}.json"))
    staged += 1

print(f"  {staged} public channels staged, {withheld} withheld (im, mpim, private)")
STAGE

say "3/7  assets"
# BEFORE the render, not after: the renderer checks whether an emoji file
# exists before it will link one, so emoji staged afterwards render as
# :shortcode: on every page. The NAS renders in the archive itself, where they
# have always been there, so this only ever went wrong here.
cp -R "$ARCHIVE/html/avatars" "$ARCHIVE/html/emojis" "$WORK/slack-archive/html/" 2>/dev/null || {
  mkdir -p "$WORK/slack-archive/html"
  cp -R "$ARCHIVE/html/avatars" "$ARCHIVE/html/emojis" "$WORK/slack-archive/html/"
}

say "4/7  rendering (public channels only)"
# Inside the image the compile has already happened and tsc is pruned away;
# on a developer machine it has not. Compile when there is something to compile
# with, and say so when there is not, rather than failing on a missing binary.
if [ -x "$REPO/node_modules/.bin/tsc" ]; then
  (cd "$REPO" && npm run compile >/dev/null 2>&1)
else
  echo "  using the prebuilt lib/ (no compiler here)"
fi
cd "$WORK" && $NODE --max-old-space-size=12288 "$REPO/bin/slack-archive.js" \
  --no-slack-connect --no-backup --force-html-generation \
  --html-exclude-kinds "$EXCLUDE_KINDS" \
  ${START_CHANNEL:+--start-channel "$START_CHANNEL"} \
  ${EXCLUDE_USER_FILES:+--exclude-user-files "$EXCLUDE_USER_FILES"} 2>&1 | grep -E "Not rendering|Search|Rendered in|Finished in|All done" || true

# search.html and data/search.js are written by the render above, from the same
# --html-exclude-kinds the pages used. Shipping the NAS's copy instead is how a
# stale index, built before an exclusion existed, ends up on the website.

say "5/7  checks - nothing is uploaded unless all six pass"
python3 - "$WORK/slack-archive" <<'PY'
import json, glob, subprocess, sys, os
D = sys.argv[1]
chans = json.load(open(f"{D}/data/channels.json"))
def kind(c):
    if c.get("is_im"): return "im"
    if c.get("is_mpim"): return "mpim"
    if c.get("is_private"): return "private"
    return "public"
def pages_of(cid):
    return glob.glob(f"{D}/html/{cid}-*.html") + glob.glob(f"{D}/html/channel-{cid}.html")

fail = []
# 1. nothing non-public rendered. By KIND, not by id prefix: Slack gives newer
#    group DMs C-ids, so a prefix test misses fourteen of them here.
bad = [c["id"] for c in chans if c.get("id") and kind(c) != "public" and pages_of(c["id"])]
if bad: fail.append(f"non-public channels with pages: {bad[:5]}")
# 2. nothing public missing. Catches a render that stopped halfway, which both
#    leak checks would happily pass.
missing = [c.get("name") for c in chans if c.get("id") and kind(c) == "public" and not pages_of(c["id"])]
if missing: fail.append(f"public channels with no pages: {missing[:5]}")
# 3. an independent check of the same question, by content rather than by id.
grp = subprocess.run(["grep","-rl","Group messaging with",f"{D}/html"],
                     capture_output=True, text=True).stdout.split()
if grp: fail.append(f"'Group messaging with' in {len(grp)} files")
# 4. search.js is built for BOTH the bot and the website, from one flag, so it
#    contains whatever the bot may see - which now includes private channels by
#    Olli's decision. The website may not. So it is filtered against the
#    channels this SITE publishes, taken from channels.json by kind, never
#    against search.js's own channel map: that map is the thing being checked.
s = open(f"{D}/data/search.js", encoding="utf8").read()
d = json.loads(s[s.index("{"):s.rindex("}")+1])
public = {c["id"] for c in chans if c.get("id") and kind(c) == "public"}
removed = {}
for key in ("channels", "messages", "pages"):
    v = d.get(key) or {}
    stray = [k for k in v if k not in public]
    if stray:
        removed[key] = len(stray)
        d[key] = {k: x for k, x in v.items() if k in public}
if removed:
    open(f"{D}/data/search.js", "w", encoding="utf8").write(
        s[:s.index("{")] + json.dumps(d, ensure_ascii=False) + ";\n")
    print(f"  search.js: removed non-public entries {removed}")

# 5. the search page must be able to start. MiniSearch throws on a duplicate
#    id, and one throw in componentDidMount is the whole search page - so a
#    file that carries two rows with one timestamp is a broken site, not a
#    slightly worse index. Checked here rather than trusted, because it was
#    broken for weeks without anything saying so.
dupes = {}
for cid, msgs in (d.get("messages") or {}).items():
    seen = set()
    n = 0
    for m in msgs:
        t = m.get("t")
        if t in seen: n += 1
        seen.add(t)
    if n: dupes[cid] = n
if dupes:
    fail.append(f"duplicate message ids in search.js: {sum(dupes.values())} in {len(dupes)} channels")

# 6. no run-state or dotfiles in a published tree.
dots = [os.path.basename(p) for p in glob.glob(f"{D}/.*") if os.path.isfile(p)]
if dots: fail.append(f"dotfiles: {dots}")

if fail:
    print("\n  REFUSING TO PUBLISH:")
    for f in fail: print(f"    - {f}")
    sys.exit(1)
print(f"  all six pass - {len(glob.glob(f'{D}/html/*.html'))} pages")
PY

if [ "$DRY_RUN" = "1" ]; then
  say "dry run - nothing uploaded. The tree is in $WORK/slack-archive"
  exit 0
fi

say "6/7  publishing"
# --exclude data/*: the message JSON is symlinks to 1.5 GB and the site does
# not need it. --exclude html/files: 41 GB of attachments live on the Hetzner
# box and are proxied at that path.
RSH="ssh -o BatchMode=yes"
[ -n "$SSH_KEY" ] && RSH="$RSH -i $SSH_KEY"
# Run as a uid with no passwd entry - which is how this runs in a container -
# and ssh has no home to look in. Point it at the file rather than letting it
# fall back to trusting whatever answers.
[ -n "$KNOWN_HOSTS" ] && RSH="$RSH -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=yes"

rsync -rlt --delete --no-owner --no-group -e "$RSH" \
  --exclude='data/*' --exclude='html/files' \
  "$WORK/slack-archive/" "$SITE/"
rsync -rlt --no-owner --no-group -e "$RSH" \
  "$WORK/slack-archive/data/search.js" "$SITE/data/"

# macOS ships openrsync, which ACCEPTS --chmod and silently ignores it, so the
# files arrive with this shell's umask - 700, which nginx's workers cannot read.
# Fixing it on the far side is the only reliable way.
$RSH "${SITE%%:*}" "chmod -R a+rX '${SITE#*:}'
  echo \"  pages: \$(ls '${SITE#*:}'/html/*.html | wc -l)\"
  echo \"  unreadable: \$(find '${SITE#*:}' -type f ! -perm -o=r | wc -l)\"
  echo \"  size: \$(du -sh '${SITE#*:}' | cut -f1)\""

# What is actually THERE, not what we meant to send. Every check above this
# line reads the tree we built; this one reads the web root, which is the thing
# somebody could fetch. data/ may hold search.js and nothing else.
say "7/7  reading the web root itself"
stray=$($RSH "${SITE%%:*}" "ls '${SITE#*:}'/data | grep -v '^search.js$' || true")
if [ -n "$stray" ]; then
  echo "  WEB ROOT HOLDS FILES IT SHOULD NOT:"
  echo "$stray" | sed 's/^/    /'
  echo "  Remove them and find out how they got there before telling anybody the site is fine."
  exit 1
fi
echo "  data/: search.js only"

dms=$($RSH "${SITE%%:*}" "ls '${SITE#*:}'/html | grep -cE '^D[A-Z0-9]+-|^G[A-Z0-9]+-' || true")
if [ "$dms" != "0" ]; then
  echo "  WEB ROOT HOLDS $dms DIRECT-MESSAGE PAGES"; exit 1
fi
echo "  html/: no direct-message pages"

say "done - $SITE"
