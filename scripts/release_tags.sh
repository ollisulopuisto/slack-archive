#!/bin/bash
# release_tags.sh - Decide whether this build may claim the version tag.
#
# Installed from the infra repo (scripts/release_tags.portable.sh). Edit it
# there, not here.
#
# THE HOLE THIS CLOSES, WHICH WAS OPENED BY THE FIX ABOVE IT
#   Moving the version from `git rev-list --count HEAD` to a CHANGELOG heading
#   made the number declared instead of derived, which is right. It also removed
#   a property nobody had noticed they were relying on: under the count scheme
#   EVERY push to main produced a different number, so a version tag could never
#   be reused.
#
#   These workflows publish on push-to-main, not on a tag. So under a declared
#   version, a docs-only push re-reads the same heading and republishes an
#   already-claimed version tag with DIFFERENT BITS. `docker/build-push-action`
#   overwrites it happily. The version then stops identifying one artifact -
#   which is the same class of bug as the drift it replaced: a name that quietly
#   means two things.
#
#   Found by the podpuri session reviewing the change rather than by the session
#   that made it.
#
# WHAT IT DOES
#   Asks the registry whether this version is already published. If it is, the
#   build ships as :latest and :<sha7> only, and says so in the job summary. The
#   image stays pullable by commit; what it does not do is overwrite a name that
#   already means something.
#
# WHY NOT JUST FAIL THE RUN
#   Because then every docs commit to main goes red, and a release run that is
#   usually red is a release run people stop reading. An unnamed image is a
#   smaller problem than a signal nobody trusts.
#
# WHY IT FAILS CLOSED
#   If the registry cannot be reached, or answers something other than "here it
#   is" / "not found", this refuses the version tag rather than assuming the
#   version is free. The two failures are not symmetric: a release missing its
#   version tag is visible and fixed by re-running, while overwriting a
#   published version is silent and permanent. Uncertainty must therefore mean
#   "do not claim it".
#
# Usage (in CI):
#   scripts/release_tags.sh ghcr.io/ollisulopuisto/thing
#     -> writes version=, publish_version=, and a summary line
#
# Env: GITHUB_TOKEN and GITHUB_ACTOR for a private package. Without them only
# public packages can be checked, and a private one reads as uncertain - which
# fails closed, by design.

set -uo pipefail

IMAGE="${1:-}"
[[ -n "$IMAGE" ]] || { echo "release_tags.sh: need an image, e.g. ghcr.io/owner/name" >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(bash "$HERE/release_version.sh")" || exit 1

REPO_PATH="${IMAGE#ghcr.io/}"

note() {
    echo "$*"
    [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "$*" >> "$GITHUB_STEP_SUMMARY"
}
out() {
    [[ -n "${GITHUB_OUTPUT:-}" ]] && echo "$1" >> "$GITHUB_OUTPUT"
}

# `|| true` on the token fetch: an unauthenticated run against a private
# package returns an error document, not a token, and that must land in the
# "uncertain" branch below rather than killing the step under `set -e`.
# Only send -u when there is something to send. `curl -u ":"` is NOT the same
# as omitting it: it makes curl attempt Basic auth with empty credentials, and
# ghcr answers that with an error document instead of the anonymous pull token
# it hands out freely to anyone who just asks. That difference turned every
# probe into "uncertain", which fails closed - so the bug hid as the safe
# behaviour and would never have shown up as a broken build.
AUTH_ARGS=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    AUTH_ARGS=(-u "${GITHUB_ACTOR:-x}:${GITHUB_TOKEN}")
fi
TOKEN="$(curl -s "${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"}" \
    "https://ghcr.io/token?scope=repository:${REPO_PATH}:pull" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)"

CODE=000
if [[ -n "$TOKEN" ]]; then
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 30 \
        -H "Authorization: Bearer $TOKEN" \
        -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json' \
        "https://ghcr.io/v2/${REPO_PATH}/manifests/${VERSION}" 2>/dev/null || echo 000)"
fi

SHA7="$(printf '%s' "${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}" | cut -c1-7)"

out "version=$VERSION"
out "sha7=$SHA7"

# The tag list is emitted here rather than written out in each workflow, so the
# decision above and the tags below cannot disagree. :sha7 is always included -
# it is what keeps a build addressable on the runs where the version tag is
# withheld, which is the whole reason withholding it is acceptable.
emit_tags() {
    echo "$IMAGE:latest"
    [[ "$1" == "true" ]] && echo "$IMAGE:$VERSION"
    echo "$IMAGE:$SHA7"
}

case "$CODE" in
    404)
        out "publish_version=true"
        TAGS="$(emit_tags true)"
        note "Releasing \`$VERSION\` — not yet in the registry."
        ;;
    200)
        out "publish_version=false"
        TAGS="$(emit_tags false)"
        note "**\`$VERSION\` is already published.** This build ships as \`:latest\` and \`:\$sha7\` only, so the existing version tag keeps meaning the artifact it already names."
        note ""
        note "This is not an error. The version comes from the top CHANGELOG heading, and this push did not change it — a docs commit, a workflow tweak, a revert. To release a new version, add a CHANGELOG entry."
        ;;
    *)
        out "publish_version=false"
        TAGS="$(emit_tags false)"
        note "**Could not determine whether \`$VERSION\` is already published** (registry answered \`$CODE\`). Refusing the version tag rather than risking an overwrite: a release missing its tag is visible and fixed by re-running, while overwriting a published version is silent and permanent."
        ;;
esac

# Multiline outputs need the heredoc form; a bare `tags=a\nb` truncates at the
# first newline and the build would publish only :latest.
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    {
        echo "tags<<RELEASE_TAGS_EOF"
        echo "$TAGS"
        echo "RELEASE_TAGS_EOF"
    } >> "$GITHUB_OUTPUT"
fi
printf 'tags:\n%s\n' "$TAGS"
