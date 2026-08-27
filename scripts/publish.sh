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
#   --timezone ZONE       IANA zone every timestamp is rendered in, e.g.
#                         Europe/Helsinki. Unset, the machine's own is used -
#                         which is UTC in a container, and that silently
#                         restates every timestamp in the archive
#   --work PATH           scratch directory (default: $TMPDIR/archive-publish)
#   --node CMD            how to run node (default: node)
#   --node-memory MB      cap the render's heap (default: node decides)
#   --render-workers N    cores to render on; fewer use less memory
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
TIMEZONE=""
WORK="${TMPDIR:-/tmp}/archive-publish"
NODE="node"
# Unset by default: node sizes its heap to the machine it is on, and this
# script runs on machines with very different amounts of memory. The old
# hardcoded 12 GB was fine on a laptop and nonsense on a NAS.
NODE_MEMORY=""
RENDER_WORKERS=""
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
    --timezone) TIMEZONE="$2"; shift 2 ;;
    --work) WORK="$2"; shift 2 ;;
    --node) NODE="$2"; shift 2 ;;
    --node-memory) NODE_MEMORY="$2"; shift 2 ;;
    --render-workers) RENDER_WORKERS="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --known-hosts) KNOWN_HOSTS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# Not fatal, because a local render of your own archive wants your own clock.
# Said out loud, because a container's own clock is UTC and a publish from one
# rewrites the wall-clock time of every message that was ever archived.
if [ -z "$TIMEZONE" ]; then
  echo "  no --timezone: rendering in this machine's zone ($(date +%Z))" >&2
fi

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

# ssh calls getpwuid() at startup and refuses to run without an entry - "No
# user exists for uid 1026". A container run with --user <host uid> has no
# passwd entry for it, and the archive renders for five minutes before rsync
# reaches ssh and dies. Check it here, where it costs nothing, and say what to
# do about it.
if [ -n "$SITE" ] && ! id -un >/dev/null 2>&1; then
  echo "This user (uid $(id -u)) has no passwd entry, and ssh will not run without one." >&2
  echo "In a container, mount the host's: -v /etc/passwd:/etc/passwd:ro" >&2
  echo "The key and known_hosts are passed explicitly, so nothing else needs the home directory." >&2
  exit 1
fi

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
$NODE "$REPO/scripts/stage-public-channels.mjs" "$ARCHIVE" "$WORK/slack-archive/data"

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
# The render's exit status decides whether anything else happens. It used to
# end in `| grep ... || true`, which takes grep's status and then throws that
# away too - so a render that SEGFAULTED walked straight into the checks, and
# the checks would have been inspecting whatever tree was left behind. A
# publish that cannot tell a finished render from a crashed one is not a
# publish, it is a coin toss.
RENDER_LOG="$WORK/render.log"

cd "$WORK" || exit 1

if ! $NODE ${NODE_MEMORY:+--max-old-space-size=$NODE_MEMORY} \
  "$REPO/bin/slack-archive.js" \
  --no-slack-connect --no-backup --force-html-generation \
  --html-exclude-kinds "$EXCLUDE_KINDS" \
  --search-exclude-kinds "$EXCLUDE_KINDS" \
  --search-index db \
  ${START_CHANNEL:+--start-channel "$START_CHANNEL"} \
  ${RENDER_WORKERS:+--render-workers "$RENDER_WORKERS"} \
  ${EXCLUDE_USER_FILES:+--exclude-user-files "$EXCLUDE_USER_FILES"} \
  ${TIMEZONE:+--timezone "$TIMEZONE"} \
  > "$RENDER_LOG" 2>&1; then
  echo "  the render FAILED - nothing will be uploaded" >&2
  echo "  last of $RENDER_LOG:" >&2
  tail -20 "$RENDER_LOG" >&2
  echo >&2
  echo "  If it died on memory: fewer workers use less of it." >&2
  echo "  Try --render-workers 2, and --node-memory to cap the heap." >&2
  exit 1
fi

grep -E "Not rendering|Search|Rendered in|Finished in|All done" "$RENDER_LOG" || true

# search.html and data/search.db are written by the render above, from the same
# exclusions the pages used - and --search-exclude-kinds is passed as well as
# --html-exclude-kinds, because the database carries channel NAMES even for
# channels it holds no messages for. Shipping the NAS's copy instead is how a
# stale index, built before an exclusion existed, ends up on the website.
#
# --search-index db: the site is served over HTTPS, so the browser reads the
# database a few kilobytes at a time. The 100 MB JavaScript index is what made
# the search page unusable on a phone, and it is not built here at all.

say "5/7  checks - nothing is uploaded unless all six pass"
$NODE "$REPO/scripts/verify-publish.mjs" "$WORK/slack-archive"

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
# The one file in data/ the site serves. It must arrive whole: a half-written
# database is a search page that opens and then throws on the first query.
rsync -rlt --no-owner --no-group -e "$RSH" \
  "$WORK/slack-archive/data/search.db" "$SITE/data/"

# macOS ships openrsync, which ACCEPTS --chmod and silently ignores it, so the
# files arrive with this shell's umask - 700, which nginx's workers cannot read.
# Fixing it on the far side is the only reliable way.
$RSH "${SITE%%:*}" "chmod -R a+rX '${SITE#*:}'
  echo \"  pages: \$(ls '${SITE#*:}'/html/*.html | wc -l)\"
  echo \"  unreadable: \$(find '${SITE#*:}' -type f ! -perm -o=r | wc -l)\"
  echo \"  size: \$(du -sh '${SITE#*:}' | cut -f1)\""

# What is actually THERE, not what we meant to send. Every check above this
# line reads the tree we built; this one reads the web root, which is the thing
# somebody could fetch. data/ may hold search.db and nothing else.
say "7/7  reading the web root itself"
stray=$($RSH "${SITE%%:*}" "ls '${SITE#*:}'/data | grep -v '^search.db$' || true")
if [ -n "$stray" ]; then
  echo "  WEB ROOT HOLDS FILES IT SHOULD NOT:"
  echo "$stray" | sed 's/^/    /'
  echo "  Remove them and find out how they got there before telling anybody the site is fine."
  exit 1
fi
echo "  data/: search.db only"

dms=$($RSH "${SITE%%:*}" "ls '${SITE#*:}'/html | grep -cE '^D[A-Z0-9]+-|^G[A-Z0-9]+-' || true")
if [ "$dms" != "0" ]; then
  echo "  WEB ROOT HOLDS $dms DIRECT-MESSAGE PAGES"; exit 1
fi
echo "  html/: no direct-message pages"

say "done - $SITE"
