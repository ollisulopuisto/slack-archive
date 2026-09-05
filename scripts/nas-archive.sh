#!/bin/sh
# Archive one Slack workspace, publish the public half, and clean up after
# itself.
#
#   Usage:  nas-archive.sh <workspace-directory-name>
#
# Machine-specific paths, hosts, and the image pin live in a config file that
# is not this script:
#
#   NAS_ARCHIVE_CONF  (default /root/.slack-archive/nas.conf)
#
# Copy scripts/nas-archive.conf.example there and fill it in. The Slack token
# is a file named after the workspace under TOKEN_DIR (default
# /root/.slack-archive/tokens/<workspace>), mounted into the container at
# /run/secrets/slack-token. It does not live in the archive tree.

set -eu

WORKSPACE="${1:?usage: nas-archive.sh <workspace-directory-name>}"
CONF="${NAS_ARCHIVE_CONF:-/root/.slack-archive/nas.conf}"

if [ ! -f "$CONF" ] && [ -f "$(dirname "$0")/nas.conf" ]; then
  CONF="$(dirname "$0")/nas.conf"
fi

if [ ! -f "$CONF" ]; then
  echo "nas-archive.sh: no config at $CONF" >&2
  echo "Copy scripts/nas-archive.conf.example and fill it in." >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$CONF"

: "${ROOT:?ROOT is required in $CONF}"
: "${IMAGE:?IMAGE is required in $CONF}"
: "${TIMEZONE:?TIMEZONE is required in $CONF}"
: "${RUN_AS:?RUN_AS is required in $CONF}"

ARCHIVE="$ROOT/$WORKSPACE/slack-archive"
TOKEN_DIR="${TOKEN_DIR:-/root/.slack-archive/tokens}"
TOKEN_FILE="$TOKEN_DIR/$WORKSPACE"
HEARTBEAT_URL_FILE="${HEARTBEAT_URL_FILE:-/root/.nas-heartbeat-url}"
START_CHANNEL="${START_CHANNEL:-}"
EXCLUDE_USER_FILES="${EXCLUDE_USER_FILES:-}"
SEARCH_EXCLUDE_USERS="${SEARCH_EXCLUDE_USERS:-}"
SYNC_KEY="${SYNC_KEY:-}"
SYNC_HOST="${SYNC_HOST:-}"
PUBLISH_DIR="${PUBLISH_DIR:-}"
SITE="${SITE:-}"
GROUP_ADD="${GROUP_ADD:-}"
MEDIA_KEY="${MEDIA_KEY:-}"
MEDIA_DEST="${MEDIA_DEST:-}"
MEDIA_PORT="${MEDIA_PORT:-23}"
MEDIA_KNOWN_HOSTS="${MEDIA_KNOWN_HOSTS:-}"

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

on_exit() {
  _status=$?
  heartbeat_stop
  [ "$_status" -eq 0 ] || log "DIED: exit $_status"
}

on_signal() {
  log "DIED: signal, stopping"
  heartbeat_stop
  exit 143
}

if [ ! -d "$ARCHIVE" ]; then
  log "FAIL: no archive directory at $ARCHIVE"
  exit 1
fi

if [ ! -f "$TOKEN_FILE" ]; then
  log "FAIL: no Slack token at $TOKEN_FILE"
  exit 1
fi

if [ ! -f /etc/passwd ]; then
  log "FAIL: no /etc/passwd to mount, ssh inside the container will not start"
  exit 1
fi

exec 9>"$LOCK"
if ! flock -n 9; then
  log "SKIP: a previous run is still going"
  exit 0
fi

CONTAINER_NAME=$(printf '%s' "slack-archive-$WORKSPACE" | tr -c 'a-zA-Z0-9_.-' '_')

DOCKER=$(find_docker) || { log "FAIL: docker not found"; exit 1; }

GROUP_ADD_ARGS=""
if [ -n "$GROUP_ADD" ]; then
  GROUP_ADD_ARGS="--group-add $GROUP_ADD"
fi

trap on_exit EXIT
trap on_signal INT TERM

log "START $IMAGE (docker: $DOCKER)"
heartbeat_start

log "PULL $IMAGE"
if "$DOCKER" pull "$IMAGE" >> "$LOG" 2>&1; then
  log "PULL OK"
else
  log "PULL WARN: failed to pull $IMAGE, continuing with local cache"
fi

sweep_backups() {
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

prune_images() {
  DOCKER="$DOCKER" "$(dirname "$0")/prune-images.sh" "$IMAGE" 3 2>&1 | while read -r line; do
    log "$line"
  done
}

sync_index() {
  if [ -z "$SYNC_KEY" ] || [ ! -f "$SYNC_KEY" ]; then
    log "SYNC SKIP: no key at ${SYNC_KEY:-'(unset)'}, nothing shipped"
    return 0
  fi

  if [ -z "$SYNC_HOST" ]; then
    log "SYNC SKIP: SYNC_HOST is empty"
    return 0
  fi

  if [ ! -f "$ARCHIVE/data/search.db" ] || [ ! -f "$ARCHIVE/data/search.js" ]; then
    log "SYNC SKIP: search.db or search.js missing in $ARCHIVE/data"
    return 0
  fi

  log "SYNC START $(du -ch "$ARCHIVE/data/search.db" "$ARCHIVE/data/search.js" 2>/dev/null | tail -1 | cut -f1)"

  # Empty path after the colon, NOT an absolute one. A key restricted to
  # rrsync resolves what it is given against that root. An absolute path
  # is stripped and nested one directory deeper, and rsync still exits 0.
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

sync_media() {
  if [ -z "$MEDIA_KEY" ] || [ ! -f "$MEDIA_KEY" ]; then
    log "MEDIA SKIP: no key at ${MEDIA_KEY:-'(unset)'}, nothing uploaded"
    return 0
  fi

  if [ -z "$MEDIA_DEST" ]; then
    log "MEDIA SKIP: MEDIA_DEST is empty"
    return 0
  fi

  if [ ! -d "$ARCHIVE/html/files" ]; then
    log "MEDIA SKIP: no files directory at $ARCHIVE/html/files"
    return 0
  fi

  log "MEDIA START"

  ssh_cmd="ssh -p $MEDIA_PORT -i $MEDIA_KEY -o StrictHostKeyChecking=yes -o BatchMode=yes"
  if [ -n "$MEDIA_KNOWN_HOSTS" ]; then
    ssh_cmd="$ssh_cmd -o UserKnownHostsFile=$MEDIA_KNOWN_HOSTS"
  fi

  if rsync -rlt \
      --exclude='@eaDir' \
      --partial --partial-dir=.rsync-partial \
      --stats --timeout=1800 \
      -e "$ssh_cmd" \
      "$ARCHIVE/html/files/" "$MEDIA_DEST" >> "$LOG" 2>&1
  then
    log "MEDIA OK"
  else
    status=$?
    log "MEDIA FAIL: exit $status"
    return "$status"
  fi
}

publish_site() {
  if [ -z "$PUBLISH_DIR" ] || [ -z "$SITE" ]; then
    log "PUBLISH SKIP: PUBLISH_DIR or SITE unset"
    return 0
  fi

  if [ ! -f "$PUBLISH_DIR/publish-key" ] || [ ! -f "$PUBLISH_DIR/known_hosts" ]; then
    log "PUBLISH SKIP: no key or known_hosts in $PUBLISH_DIR"
    return 0
  fi

  mkdir -p "$PUBLISH_DIR/publish-work"
  log "PUBLISH START"

  if "$DOCKER" run --rm \
      --name "${CONTAINER_NAME}_publish" \
      --user "$RUN_AS" \
      $GROUP_ADD_ARGS \
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
        ${START_CHANNEL:+--start-channel "$START_CHANNEL"} \
        ${EXCLUDE_USER_FILES:+--exclude-user-files "$EXCLUDE_USER_FILES"} >> "$LOG" 2>&1
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
if "$DOCKER" run --rm \
    --name "$CONTAINER_NAME" \
    --user "$RUN_AS" \
    $GROUP_ADD_ARGS \
    -e TZ="$TIMEZONE" \
    -e HOME=/tmp \
    -e TRASH_HARDER=1 \
    -e SLACK_TOKEN_FILE=/run/secrets/slack-token \
    -v "$ARCHIVE:/app/slack-archive" \
    -v "$TOKEN_FILE:/run/secrets/slack-token:ro" \
    "$IMAGE" \
    node bin/slack-archive.js --automatic \
      --timezone "$TIMEZONE" \
      --search-exclude-kinds im,mpim \
      ${SEARCH_EXCLUDE_USERS:+--search-exclude-users "$SEARCH_EXCLUDE_USERS"} \
      ${EXCLUDE_USER_FILES:+--exclude-user-files "$EXCLUDE_USER_FILES"} >> "$LOG" 2>&1
then
  sweep_backups
  log "OK"
  sync_index
  sync_media || true
  publish_site || true
  prune_images
else
  status=$?
  log "FAIL: exit $status"
  exit "$status"
fi

tail -n 5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
