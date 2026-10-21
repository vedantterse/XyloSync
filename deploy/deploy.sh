#!/usr/bin/env bash
# Deploy one image tag of XyloSync, check it is healthy, and roll back automatically if not.
#
#   ./deploy.sh sha-7e511f5
#
# The last 5 deployed images stay on the server, so rolling back never needs a download.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?usage: ./deploy.sh <image-tag>   e.g. ./deploy.sh sha-7e511f5}"
IMAGE="$(grep -E '^IMAGE=' .env | cut -d= -f2- || true)"
IMAGE="${IMAGE:-ghcr.io/vedantterse/xylosync}"
COMPOSE=(docker compose -f docker-compose.prod.yml)
HISTORY=.deploy-history
KEEP=5

current="$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2- || true)"

set_tag() {
    if grep -qE '^IMAGE_TAG=' .env; then
        sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" .env
    else
        echo "IMAGE_TAG=$1" >> .env
    fi
}

healthy() {
    for _ in $(seq 1 40); do
        if "${COMPOSE[@]}" exec -T app wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
            return 0
        fi
        sleep 3
    done
    return 1
}

echo "==> Deploying $IMAGE:$TAG (running now: ${current:-nothing})"
if ! docker pull "$IMAGE:$TAG"; then
    docker image inspect "$IMAGE:$TAG" >/dev/null 2>&1 || { echo "!! Image $IMAGE:$TAG not found"; exit 1; }
    echo "    Using the copy already on this server."
fi

set_tag "$TAG"
# `up` itself fails when the new app never gets healthy (Caddy waits for it), so treat a failed
# start exactly like a failed health check: both must lead to the rollback below.
started=true
"${COMPOSE[@]}" up -d --remove-orphans || started=false

if [[ "$started" != true ]] || ! healthy; then
    echo "!! $TAG did not become healthy. Recent app logs:"
    "${COMPOSE[@]}" logs --tail 40 app || true
    if [[ -n "$current" && "$current" != "$TAG" && "$current" != "latest" ]]; then
        echo "==> Rolling back to $current"
        set_tag "$current"
        "${COMPOSE[@]}" up -d --remove-orphans
        healthy && echo "==> Back on $current"
    fi
    exit 1
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $TAG" >> "$HISTORY"
echo "==> $TAG is live"

# Keep only the images of the last $KEEP deploys.
keep="$(tail -n "$KEEP" "$HISTORY" | awk '{print $2}' | sort -u)"
for t in $(docker image ls "$IMAGE" --format '{{.Tag}}'); do
    grep -qx "$t" <<<"$keep" || docker image rm "$IMAGE:$t" >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null
