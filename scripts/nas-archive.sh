#!/bin/sh
# Archive one Slack workspace on this NAS, publish the public half, and clean
# up after itself.
#
#   Usage:  nas-archive.sh <workspace-directory-name>
#   e.g.    nas-archive.sh mörttinen
#
# Runs from DSM Task Scheduler as root, which is the only user here that can
# talk to Docker. The containers themselves run as dst:users (1026:100) so
# every file they write stays owned by the person who owns the archive.
#
# This lives in the repository rather than only on the NAS for the same reason
# scripts/publish.sh does: a hand-maintained copy on one machine cannot be
# reviewed, cannot be tested, and drifts from the thing it is meant to run.
# Install it by copying it to the NAS; the paths below are this NAS's.

set -eu

WORKSPACE="${1:?usage: nas-archive.sh <workspace-directory-name>}"
ROOT="/volume2/backup/slack-archive"
ARCHIVE="$ROOT/$WORKSPACE/slack-archive"

# Pinned deliberately. `latest` would mean the nightly run silently changes
# what it is running; this way an upgrade is a one-line edit made on purpose.
IMAGE="ghcr.io/ollisulopuisto/slack-archive:26.08.29.200"

# Where the search index is shipped after a successful run. The key lives under
# /root because the DSM task runs as root and because /volume2 is shared over
# SMB - a private key there would be readable by anything that mounts the share.
SYNC_KEY="/root/.ssh/slack-archive-sync"
SYNC_HOST="ubuntu@79.76.61.41"

# The published site, and the credentials for it. Separate key from the index
# sync: that one is locked to rrsync over the data directory, this one writes
# the web root.
PUBLISH_DIR="/volume2/docker/morttinen"
SITE="ubuntu@79.76.61.41:/opt/stacks/morttinen/site"
START_CHANNEL="offtopic"
EXCLUDE_USER_FILES="historia,backlog"

# Stated, not inherited. Every timestamp on every page is formatted in the
# renderer's local zone, and a container's is UTC - so leaving this out
# republishes ten years of messages three hours earlier than they happened.
TIMEZONE="Europe/Helsinki"

# The NAS sleeps when nothing is asking it to stay awake, and a render is
# forty minutes of CPU that Home Assistant cannot see. This pings a webhook
# every four minutes so the machine is not shut down mid-run.
#
#   Create it once:  echo 'http://HOST:8123/api/webhook/ID' > /root/.nas-heartbeat-url
HEARTBEAT_URL_FILE="/root/.nas-heartbeat-url"
HEARTBEAT_PID=""

LOG="$ROOT/logs/$WORKSPACE.log"
LOCK="$ROOT/logs/$WORKSPACE.lock"

mkdir -p "$ROOT/logs"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
}

heartbeat_start() {
  if [ ! -f "$HEARTBEAT_URL_FILE" ]; then
    log "HEARTBEAT SKIP: no $HEARTBEAT_URL_FILE - the NAS may shut down mid-render"
    return 0
  fi

  url=$(cat "$HEARTBEAT_URL_FILE")
  if [ -z "$url" ]; then
    log "HEARTBEAT SKIP: $HEARTBEAT_URL_FILE is empty"
    return 0
  fi

  # Prove it reaches HA before relying on it, rather than discovering at
  # shutdown that every ping had been failing quietly.
  if ! curl -sf -m 10 -X POST -H 'Content-Type: application/json' \
      -d '{"client":"nas-archive.sh"}' "$url" >/dev/null 2>&1
  then
    log "HEARTBEAT SKIP: webhook unreachable - the NAS may shut down mid-render"
    return 0
  fi

  while :; do
    sleep 240
    curl -sf -m 10 -X POST -H 'Content-Type: application/json' \
      -d '{"client":"nas-archive.sh"}' "$url" >/dev/null 2>&1 \
      || log "HEARTBEAT: ping failed"
  done &
  HEARTBEAT_PID=$!
  log "HEARTBEAT started (pid $HEARTBEAT_PID)"
}

heartbeat_stop() {
  [ -n "$HEARTBEAT_PID" ] || return 0
  kill "$HEARTBEAT_PID" 2>/dev/null || true
  HEARTBEAT_PID=""
}

# Docker is found rather than assumed to be on PATH.
#
# DSM's Task Scheduler runs with root's full environment and finds `docker`;
# `sudo sh nas-archive.sh` does not - and a manual run is exactly how this
# script gets used when a nightly run has failed and somebody is fixing it.
# Synology keeps the binary inside the package rather than anywhere standard.
find_docker() {
  for candidate in \
    /usr/local/bin/docker \
    /var/packages/ContainerManager/target/usr/bin/docker \
    /var/packages/Docker/target/usr/bin/docker \
    /usr/bin/docker
  do
    [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  done
  command -v docker 2>/dev/null && return 0
  return 1
}

# One line in the log however this script dies.
#
# The 04:00 run on 2026-08-26 produced NOTHING: no START, no FAIL, no output at
# all - a function called above its own definition ended the run at exit 127
# before the first log call, and Task Scheduler discards stderr unless a save
# folder is configured. A silent failure looked identical to a machine that
# never woke up. This trap is the difference between that and a line naming the
# status, and it is set AFTER the functions it calls are defined, which is the
# bug it exists to report.
on_exit() {
  _status=$?
  heartbeat_stop
  [ "$_status" -eq 0 ] || log "DIED: exit $_status"
}

# A signal handler that RETURNS lets the script carry on, which once turned
# this trap into an accidental shield: a run survived two rounds of `kill
# -TERM` and had to be killed with -9 while its container was already gone.
# Clean up, then die like a program that was told to stop.
on_signal() {
  log "DIED: signal, stopping"
  heartbeat_stop
  exit 143
}

if [ ! -d "$ARCHIVE" ]; then
  log "FAIL: no archive directory at $ARCHIVE"
  exit 1
fi

if [ ! -f "$ARCHIVE/.token" ]; then
  log "FAIL: no Slack token at $ARCHIVE/.token"
  exit 1
fi

# A container running as uid 1026 with no passwd entry breaks ssh: getpwuid()
# fails and it refuses to start, which is how the first publish attempt died.
if [ ! -f /etc/passwd ]; then
  log "FAIL: no /etc/passwd to mount, ssh inside the container will not start"
  exit 1
fi

# One run at a time. A nightly job that overlaps its predecessor would have two
# processes writing the same channel files, and the loser wins.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "SKIP: a previous run is still going"
  exit 0
fi

# Docker allows only [a-zA-Z0-9][a-zA-Z0-9_.-] in a container name, and this
# workspace is called "mörttinen". An ö costs exit 125 before the archiver
# starts, so the name is folded to ASCII rather than passed through.
CONTAINER_NAME=$(printf '%s' "slack-archive-$WORKSPACE" | tr -c 'a-zA-Z0-9_.-' '_')

# Resolved once, before anything uses it, so a missing binary fails here with a
# logged reason instead of at the line that does the work.
DOCKER=$(find_docker) || { log "FAIL: docker not found"; exit 1; }

trap on_exit EXIT
trap on_signal INT TERM

log "START $IMAGE (docker: $DOCKER)"
heartbeat_start

# Every run copies the whole data directory to data_backup_<timestamp> - 1.5 GB
# a night - and nothing in the tool reclaims it on a schedule like this. When
# trash() succeeds it moves the directory to a hidden .Trash-<uid> on the same
# volume, which frees nothing. So this sweep is what actually holds the disk
# flat, and it is written to be true whichever path the tool took.
sweep_backups() {
  # Two kept: the run before this one, and the one before that.
  ls -1dt "$ARCHIVE"/data_backup_* 2>/dev/null | tail -n +3 | while read -r old; do
    log "removing old backup $(basename "$old")"
    rm -rf "$old"
  done

  for trashed in "$ARCHIVE"/.Trash-*; do
    [ -d "$trashed" ] || continue
    log "removing trashed backup $(basename "$trashed")"
    rm -rf "$trashed"
  done
}

# Old images of this archiver, which nothing else reclaims. The rules and the
# reasoning are in scripts/prune-images.sh, which is where they can be tested;
# it runs from here rather than on a schedule of its own because a separate
# timer drifts out of step with the thing it is cleaning up after.
prune_images() {
  DOCKER="$DOCKER" "$(dirname "$0")/prune-images.sh" "$IMAGE" 3 2>&1 | while read -r line; do
    log "$line"
  done
}

# Ship the search data to the VPS that serves it. Only after a successful run,
# and from this script rather than a schedule of its own: a separate job could
# start mid-rebuild and copy a half-written database.
sync_index() {
  if [ ! -f "$SYNC_KEY" ]; then
    log "SYNC SKIP: no key at $SYNC_KEY, nothing shipped"
    return 0
  fi

  if [ ! -f "$ARCHIVE/data/search.db" ] || [ ! -f "$ARCHIVE/data/search.js" ]; then
    log "SYNC SKIP: search.db or search.js missing in $ARCHIVE/data"
    return 0
  fi

  log "SYNC START $(du -ch "$ARCHIVE/data/search.db" "$ARCHIVE/data/search.js" 2>/dev/null | tail -1 | cut -f1)"

  # Empty path after the colon, NOT an absolute one. The key on the far end is
  # restricted to `rrsync -wo /home/ubuntu/historia/slack-archive/data`, and
  # rrsync resolves what it is given against that root. Handed an absolute path
  # it does not refuse: it strips the leading slash and resolves anyway, so the
  # files would nest one directory deeper and rsync would exit 0. The log would
  # read SYNC OK while the bot kept reading the old index.
  if rsync -z --timeout=1800 \
      -e "ssh -i $SYNC_KEY -o StrictHostKeyChecking=yes -o BatchMode=yes" \
      "$ARCHIVE/data/search.db" "$ARCHIVE/data/search.js" \
      "$SYNC_HOST:" >> "$LOG" 2>&1
  then
    log "SYNC OK"
  else
    status=$?
    log "SYNC FAIL: exit $status"
    return "$status"
  fi
}

# Render the public half of the archive and put it on the web host. The same
# image, because the renderer and the archiver are the same program; the
# archive mounted READ-ONLY, because a publish renders from an archive and must
# never write to it.
publish_site() {
  if [ ! -f "$PUBLISH_DIR/publish-key" ] || [ ! -f "$PUBLISH_DIR/known_hosts" ]; then
    log "PUBLISH SKIP: no key or known_hosts in $PUBLISH_DIR"
    return 0
  fi

  mkdir -p "$PUBLISH_DIR/publish-work"
  log "PUBLISH START"

  if "$DOCKER" run --rm \
      --name "${CONTAINER_NAME}_publish" \
      --user 1026:100 \
      --group-add 101 \
      --entrypoint bash \
      -e TZ="$TIMEZONE" \
      -e HOME=/tmp \
      -v "$ARCHIVE:/archive:ro" \
      -v "$PUBLISH_DIR/publish-work:/work" \
      -v "$PUBLISH_DIR/publish-key:/keys/id_ed25519:ro" \
      -v "$PUBLISH_DIR/known_hosts:/keys/known_hosts:ro" \
      -v /etc/passwd:/etc/passwd:ro \
      "$IMAGE" \
      scripts/publish.sh --archive /archive --work /work \
        --site "$SITE" \
        --ssh-key /keys/id_ed25519 --known-hosts /keys/known_hosts \
        --timezone "$TIMEZONE" \
        --start-channel "$START_CHANNEL" \
        --exclude-user-files "$EXCLUDE_USER_FILES" >> "$LOG" 2>&1
  then
    log "PUBLISH OK"
  else
    status=$?
    log "PUBLISH FAIL: exit $status"
    return "$status"
  fi
}

# THE TWO EXCLUDE FLAGS DIFFER ON PURPOSE. DO NOT "FIX" THE MISMATCH.
#
#   the publish, the website:  --exclude-kinds        im,mpim,private
#   the archive run, the bot:  --search-exclude-kinds im,mpim
#
# The website excludes private everywhere; the bot's index does not. Two
# indexes are built, on purpose, because one file cannot answer to both rules.
#
# Olli's rule, 2026-08-26: no private channels in the HTML archive at all, not
# even behind the login - but private channels ARE searchable through the Slack
# bot, for people who are members of the channel. Different audiences,
# different media, different exclusions. DMs and group DMs stay out of both.
#
# The bot enforces membership itself, from the channel_members rows that enter
# search.db from image .155 onward. Setting `private` here would take private
# channels out of the bot's index silently, and nothing would report it: search
# would simply stop finding things that are still archived.
#
# --user keeps file ownership as dst:users, and --group-add 101 is what makes
# the mount readable at all. The archive tree carries a Synology ACL whose only
# entry is `group:administrators:allow:rwx...`, and a Synology ACL overrides the
# POSIX mode - so `ls` shows drwxrwxrwx while a process outside gid 101 cannot
# even traverse it. Without this the container could not read .token, and the
# archiver did what it does when there is no token: prompted, and exited having
# archived nothing, while the wrapper logged OK.
if "$DOCKER" run --rm \
    --name "$CONTAINER_NAME" \
    --user 1026:100 \
    --group-add 101 \
    -e TZ="$TIMEZONE" \
    -e HOME=/tmp \
    -e TRASH_HARDER=1 \
    -v "$ARCHIVE:/app/slack-archive" \
    "$IMAGE" \
    node bin/slack-archive.js --automatic \
      --timezone "$TIMEZONE" \
      --search-exclude-kinds im,mpim \
      --search-exclude-users historia,backlog \
      --exclude-user-files "$EXCLUDE_USER_FILES" >> "$LOG" 2>&1
then
  sweep_backups
  log "OK ($(df -h /volume2 | awk 'NR==2 {print $4}') free on /volume2)"
  sync_index
  # A failed publish is not a failed archive: the messages are safely on disk
  # either way, and a non-zero exit here would tell DSM the archive broke.
  publish_site || true
  prune_images
else
  status=$?
  log "FAIL: exit $status"
  # Non-zero exit makes DSM send the notification e-mail, if enabled on the task.
  exit "$status"
fi

# Keep the log from growing without end: last 5000 lines is several runs.
tail -n 5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
