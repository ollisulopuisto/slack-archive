#!/bin/sh
# Remove old images of one repository, keeping the newest few and the one that
# is pinned.
#
#   Usage:  prune-images.sh <pinned-image> [keep]
#   e.g.    prune-images.sh ghcr.io/ollisulopuisto/slack-archive:26.08.27.190 3
#
# A pinned CalVer tag means every upgrade leaves the previous image behind, and
# on the NAS they arrive at about a gigabyte a day against a volume that is
# already at 98%. Watchtower is not the answer to that: it follows a moving
# tag, which is the thing the pin exists to refuse.
#
# This runs from the job that pulls, not from a schedule of its own - a
# separate timer drifts out of step with the thing it is cleaning up after.
#
# DOCKER overrides the command, which is what the tests use.

set -eu

IMAGE="${1:?usage: prune-images.sh <pinned-image> [keep]}"
KEEP="${2:-3}"
DOCKER="${DOCKER:-docker}"
REPO="${IMAGE%:*}"

# Newest first, so what survives is the newest $KEEP. Untagged layers are left
# to `image prune` below: <none>:<none> is not a name rmi can be trusted with.
$DOCKER images "$REPO" --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' \
  | sort -r \
  | cut -d'|' -f2 \
  | grep -v '<none>' \
  | tail -n +$((KEEP + 1)) \
  | while read -r old; do
      # Never the pinned one, whatever its age: the pin is what the next run
      # will start, and an upgrade that is older than three later experiments
      # is still the thing in production.
      if [ "$old" = "$IMAGE" ]; then
        echo "kept $old (pinned)"
        continue
      fi

      if $DOCKER rmi "$old" >/dev/null 2>&1; then
        echo "removed $old"
      else
        echo "kept $old (in use or already gone)"
      fi
    done

# Untagged layers left behind by a pull that replaced a tag. -f because there
# is nobody at the keyboard to answer the prompt; dangling only, so nothing
# that still has a name can be caught by it.
$DOCKER image prune -f --filter dangling=true >/dev/null 2>&1 || true
