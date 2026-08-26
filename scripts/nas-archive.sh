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
IMAGE="ghcr.io/ollisulopuisto/slack-archive:26.08.27.193"

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

LOG="$ROOT/logs/$WORKSPACE.log"
LOCK="$ROOT/logs/$WORKSPACE.lock"

mkdir -p "$ROOT/logs"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
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

log "START $IMAGE"

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
  "$(dirname "$0")/prune-images.sh" "$IMAGE" 3 2>&1 | while read -r line; do
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

  if docker run --rm \
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

# --user keeps file ownership as dst:users, and --group-add 101 is what makes
# the mount readable at all. The archive tree carries a Synology ACL whose only
# entry is `group:administrators:allow:rwx...`, and a Synology ACL overrides the
# POSIX mode - so `ls` shows drwxrwxrwx while a process outside gid 101 cannot
# even traverse it. Without this the container could not read .token, and the
# archiver did what it does when there is no token: prompted, and exited having
# archived nothing, while the wrapper logged OK.
if docker run --rm \
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
      --search-exclude-kinds im,mpim,private \
      --search-exclude-users historia,backlog >> "$LOG" 2>&1
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
