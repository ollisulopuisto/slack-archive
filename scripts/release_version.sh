#!/bin/bash
# release_version.sh - The version this build is called, read from the one
# place it is written.
#
# Installed from the infra repo (scripts/release_version.portable.sh). Edit it
# there, not here, or the copies drift - which is the same class of bug this
# script exists to prevent.
#
# WHY NOT `git rev-list --count HEAD`
#   That is what this replaced, and it is derived rather than declared:
#     - a squash merge collapses many commits into one, moving the count by an
#       amount that has nothing to do with what shipped
#     - a rebase changes it wholesale
#     - two branches developed in parallel produce the SAME count, so two
#       machines committing at once genuinely can claim one number
#   None of it can be reconciled afterwards, because a count has no memory of
#   what it used to be.
#
#   Worse, it drifts silently against a CHANGELOG that numbers the same builds
#   by hand. paikallislehti ran both schemes at once; by 2026-08-20 they were
#   four apart, in the opposite direction to a comment recording the old offset
#   as fact, and two sessions read that comment and concluded the live site had
#   to be rolled BACK. The tag 26.08.20.387 and the CHANGELOG's v26.08.20.391
#   were the same build. Measured across the estate on 2026-08-22, five of
#   eight repos running both schemes were drifting: -3 to +5.
#
#   A CHANGELOG heading is one line in one file. Two sessions claiming one
#   number edit the same line, and git refuses the second. The collision is not
#   prevented by cleverness; it is made loud, at commit time, where it is cheap.
#
# Numbers may be skipped. The file is the source of truth, not a count.
#
# Usage:
#   release_version.sh          print the version, e.g. 26.08.22.407
#   release_version.sh --next   print the next version to claim
#
# Exits non-zero rather than inventing a version. A guessed version is
# indistinguishable from a real one until someone tries to pull the image.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG="${RELEASE_CHANGELOG:-$ROOT/CHANGELOG.md}"

die() { printf 'release_version.sh: %s\n' "$*" >&2; exit 1; }

[[ -f "$CHANGELOG" ]] || die "no CHANGELOG.md at $CHANGELOG - nothing declares the version"

# The FIRST heading, not the first one that happens to parse. Falling through to
# the entry below an "## [Unreleased]" someone is still writing names the build
# after the PREVIOUS release: the same drift, quieter and harder to spot.
first="$(grep -oE '^## \[[^]]+\]' "$CHANGELOG" | head -1 | sed 's/^## \[//; s/\]$//')"
[[ -n "$first" ]] || die "no '## [version]' heading in $CHANGELOG"

if [[ ! "$first" =~ ^v?[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$ ]]; then
    die "the top CHANGELOG heading is \"$first\", which is not a CalVer version.
       The heading names the build, so it has to BE the version being released.
       An '## [Unreleased]' at the top means every build takes the previous
       release's number until someone notices."
fi

case "${1:-}" in
    "")
        echo "${first#v}"
        ;;
    --next)
        # The maximum across every number the file has ever carried - never
        # just the top one, so an out-of-order edit cannot reissue a number.
        highest="$(grep -oE '^## \[v?[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]+\]' "$CHANGELOG" \
            | grep -oE '[0-9]+\]$' | tr -d ']' | sort -n | tail -1)"
        # Deliberately NOT max()'d against `git rev-list --count HEAD`.
        #
        # That was the first version of this line, to stop the first release
        # after the switch being numbered BELOW tags the old scheme had already
        # published. It works exactly once. After it, the count keeps growing
        # with every commit, so max(file, count) tracks the count forever and
        # the file stops being the source of truth - reintroducing the drift
        # this script exists to end, disguised as a safety measure.
        #
        # The one-time problem got a one-time fix: each repo's CHANGELOG was
        # bumped past its old count at migration. From here the file is alone.
        printf '%s.%d\n' "$(date +%y.%m.%d)" "$((highest + 1))"
        ;;
    -h|--help)
        sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
        ;;
    *)
        die "unknown option: $1
       usage: release_version.sh [--next]"
        ;;
esac
