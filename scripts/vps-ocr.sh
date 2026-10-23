#!/bin/bash
# Read the text out of the archive's pictures, on a machine that is not the NAS.
#
#   Usage:  vps-ocr.sh
#
# The NAS archives, builds the search index and publishes. Reading 40 000
# pictures with Tesseract is hours of CPU, which is the one thing it has least
# of, so this does it somewhere else and the NAS takes the result:
#
#   NAS  --(nas-archive.sh pushes)-->  $WORK/data   channels.json, message files
#   storage box  --(sshfs, read only)-->  $WORK/files   the pictures themselves
#   this script reads the pictures that have no reading yet
#   NAS  <--(nas-archive.sh fetches)--  $WORK/data/ocr.jsonl
#
# Run it from cron or a systemd timer, as often as you like: it reads only what
# has not been read, and two runs never overlap.
#
# Configuration lives in a file that is not this script:
#
#   VPS_OCR_CONF  (default ~/.slack-archive/vps-ocr.conf)
#
# Copy scripts/vps-ocr.conf.example there and fill it in. Needs podman, sshfs
# and fuse3.
#
# Nothing is written to the storage box, and the pictures are not copied: they
# are read through the mount one at a time, so the disk here only holds the
# message files and the readings.

set -euo pipefail

CONF="${VPS_OCR_CONF:-$HOME/.slack-archive/vps-ocr.conf}"

if [ ! -f "$CONF" ]; then
  echo "vps-ocr.sh: no config at $CONF" >&2
  echo "Copy scripts/vps-ocr.conf.example there and fill it in." >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$CONF"

: "${IMAGE:?IMAGE is required in $CONF}"
: "${BOX:?BOX is required in $CONF}"
: "${BOX_KEY:?BOX_KEY is required in $CONF}"

WORK="${WORK:-$HOME/slack-archive-ocr}"
BOX_PORT="${BOX_PORT:-23}"
BOX_PATH="${BOX_PATH:-.}"
BOX_KNOWN_HOSTS="${BOX_KNOWN_HOSTS:-}"
CONCURRENCY="${CONCURRENCY:-$(nproc)}"

LOG="$WORK/ocr.log"
mkdir -p "$WORK/data" "$WORK/files"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
}

# The tag is what names the OCR image built below, so a tag that moves is a
# tag whose image is never rebuilt. And the architecture matters: only a tagged
# release is certain to carry an arm64 image, which is what this machine may be.
case "${IMAGE##*:}" in
  latest | "$IMAGE")
    log "FAIL: IMAGE must name a version, not :latest - $IMAGE"
    echo "vps-ocr.sh: IMAGE must name a version (for example ...:26.10.23.260)" >&2
    exit 1
    ;;
esac

exec 9> "$WORK/.lock"
if ! flock -n 9; then
  log "SKIP: a previous run is still going"
  exit 0
fi

if [ ! -f "$WORK/data/channels.json" ]; then
  log "SKIP: no channels.json in $WORK/data - nothing has been sent from the NAS yet"
  exit 0
fi

OCR_IMAGE="slack-archive-ocr:${IMAGE##*:}"
mounted=0

cleanup() {
  status=$?
  if [ "$mounted" = 1 ]; then
    fusermount3 -u "$WORK/files" 2> /dev/null || fusermount -u "$WORK/files" 2> /dev/null || true
  fi
  [ "$status" -eq 0 ] || log "DIED: exit $status"
  tail -n 5000 "$LOG" > "$LOG.tmp" 2> /dev/null && mv "$LOG.tmp" "$LOG"
}
trap cleanup EXIT

log "START $IMAGE ($CONCURRENCY at once)"

# The release image has the archiver and no Tesseract. Adding it here, to a
# copy that stays on this machine, keeps it out of the image the NAS pulls every
# night and out of the pipeline that builds it. Built once per version.
if ! podman pull --quiet "$IMAGE" > /dev/null 2>> "$LOG"; then
  log "PULL WARN: could not pull $IMAGE, continuing with what is here"
fi

if ! podman image exists "$OCR_IMAGE"; then
  log "BUILD $OCR_IMAGE"
  context="$WORK/build"
  mkdir -p "$context"
  cat > "$context/Dockerfile" << DOCKERFILE
FROM $IMAGE
USER root
RUN apt-get update \\
  && apt-get install --no-install-recommends -y \\
    tesseract-ocr tesseract-ocr-fin tesseract-ocr-eng \\
  && rm -rf /var/lib/apt/lists/*
USER node
DOCKERFILE
  podman build --quiet -t "$OCR_IMAGE" -f "$context/Dockerfile" "$context" >> "$LOG" 2>&1
fi

# The pictures stay on the storage box and are read through this mount, read
# only, as the account that was given for it. `reconnect` and the keepalives are
# for a long run over a link that will drop at some point in it.
if ! mountpoint -q "$WORK/files"; then
  options="ro,IdentityFile=$BOX_KEY,StrictHostKeyChecking=yes,BatchMode=yes,reconnect,ServerAliveInterval=15,ServerAliveCountMax=3"
  if [ -n "$BOX_KNOWN_HOSTS" ]; then
    options="$options,UserKnownHostsFile=$BOX_KNOWN_HOSTS"
  fi

  sshfs -p "$BOX_PORT" -o "$options" "$BOX:$BOX_PATH" "$WORK/files"
  mounted=1
fi

# --userns=keep-id: the mount belongs to this user, and FUSE lets nobody else
# read it, so the process inside has to BE this user as far as the mount can
# tell. nice, so the machine stays usable while it works.
status=0
nice -n 10 podman run --rm \
  --userns=keep-id \
  -e HOME=/tmp \
  -e OCR_CONCURRENCY="$CONCURRENCY" \
  -v "$WORK/data:/app/slack-archive/data" \
  -v "$WORK/files:/app/slack-archive/html/files:ro" \
  "$OCR_IMAGE" \
  node lib/ocr-images.js >> "$LOG" 2>&1 || status=$?

if [ "$status" -eq 0 ]; then
  log "OK: $(wc -l < "$WORK/data/ocr.jsonl" 2> /dev/null | tr -d ' ' || echo 0) readings"
else
  # A picture that could not be read is not remembered and is tried again next
  # time; the exit code says some failed, not that the run was lost.
  log "DONE WITH FAILURES: exit $status"
fi

exit "$status"
