#!/usr/bin/env bash
# Go back to the version that was live before the current one (or to a tag you name).
#
#   ./rollback.sh                 # previous version
#   ./rollback.sh sha-1a2b3c4     # a specific earlier version
#   ./rollback.sh --list          # show what was deployed and when
set -euo pipefail
cd "$(dirname "$0")"
HISTORY=.deploy-history

[[ -f "$HISTORY" ]] || { echo "No deploys recorded yet."; exit 1; }

if [[ "${1:-}" == "--list" ]]; then
    tail -n 10 "$HISTORY"
    exit 0
fi

current="$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2-)"
if [[ -n "${1:-}" ]]; then
    target="$1"
else
    # The most recent tag in the history that isn't the one running now.
    target="$(awk '{print $2}' "$HISTORY" | grep -vx "$current" | tail -n 1 || true)"
fi
[[ -n "$target" ]] || { echo "Nothing to roll back to."; exit 1; }

echo "==> Rolling back from $current to $target"
exec ./deploy.sh "$target"
