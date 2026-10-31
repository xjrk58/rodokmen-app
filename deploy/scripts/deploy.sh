#!/usr/bin/env bash
# Health-checked switch between the two API slots (operations spec, "Deploys from CI").
#
#   scripts/deploy.sh <image>     start <image> in the idle slot, switch when healthy
#   scripts/deploy.sh rollback    start the previously active image again, the same way
#
# The new version starts next to the running one (both answer to "api" for Caddy). Only when
# its health check passes is the old slot stopped. If it fails, the new slot is removed, the
# old version keeps serving, the Owner gets an alert, and the script exits non-zero so CI
# shows the failed deploy.
#
# Migrations run when the new version starts, while the old one still serves: each release's
# migrations must keep working with the previous release (add, don't rename or drop, in one go).
set -Eeuo pipefail
cd "$(dirname "$0")/.."

STATE=state
IMAGES="$STATE/images.env"
mkdir -p "$STATE"
touch "$IMAGES"

compose() { docker compose --env-file .env --env-file "$IMAGES" "$@"; }
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

active=$(cat "$STATE/active" 2>/dev/null || echo none)
case "$active" in
  blue) idle=green ;;
  green) idle=blue ;;
  *) active=none; idle=blue ;;
esac

image_of() { grep -E "^API_IMAGE_${1^^}=" "$IMAGES" | tail -1 | cut -d= -f2- || true; }

set_var() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  grep -vE "^${key}=" "$IMAGES" > "$tmp" || true
  echo "${key}=${value}" >> "$tmp"
  mv "$tmp" "$IMAGES"
}

alert() {
  # Sent from the version that keeps running (or the watchdog image) so that it works even
  # when the new image is broken.
  local subject=$1 details=$2
  if [ "$active" != none ] && compose exec -T "api-$active" node dist/cli.js alert --subject "$subject" --details "$details"; then return 0; fi
  compose run --rm --no-deps watchdog node dist/cli.js alert --subject "$subject" --details "$details" || log "could not send the alert: $subject"
}

target=${1:?usage: deploy.sh <image> | rollback}
if [ "$target" = rollback ]; then
  target=$(cat "$STATE/previous" 2>/dev/null || true)
  [ -n "$target" ] || { log "no previous image recorded"; exit 1; }
fi

log "deploying $target into api-$idle (active: $active)"
docker pull "$target"
# The database, the image store and Caddy are started if they are not running yet (first
# deploy, reboot). Then both take the configuration this deploy copied; caddy/ and garage/ are
# mounted as folders, so the containers see the new files. Caddy reloads its Caddyfile (if the new
# one is invalid, Caddy keeps the one it has). Garage reads garage.toml only when it starts, so it
# restarts when the file changed. Then the image store gets its bucket and keys (idempotent).
compose up -d db garage caddy
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || log "could not reload the Caddyfile; Caddy keeps the one it has"
garage_conf=$(sha256sum garage/garage.toml | cut -d' ' -f1)
if [ -f "$STATE/garage.sha256" ] && [ "$(cat "$STATE/garage.sha256")" != "$garage_conf" ]; then
  log "garage.toml changed; restarting Garage"
  compose restart garage
fi
echo "$garage_conf" > "$STATE/garage.sha256"
if ! ./scripts/storage-init.sh; then
  log "the image store is not ready; nothing was switched"
  serving=$([ "$active" != none ] && echo "api-$active keeps serving" || echo "nothing was serving yet")
  alert "Deploy failed: the image store is not ready" "scripts/storage-init.sh failed before $target was started; $serving. See the deploy log."
  exit 1
fi
set_var "API_IMAGE_${idle^^}" "$target"

if compose up -d --no-deps --wait --wait-timeout 180 "api-$idle"; then
  log "api-$idle is healthy; switching"
  previous=$( [ "$active" != none ] && image_of "$active" || true)
  echo "$idle" > "$STATE/active"
  [ -n "$previous" ] && echo "$previous" > "$STATE/previous"
  if [ "$active" != none ]; then compose stop "api-$active"; fi
  set_var WATCHDOG_IMAGE "$target"
  set_var MCP_IMAGE "$target"
  compose up -d --no-deps watchdog mcp
  log "deployed $target"
else
  log "api-$idle failed its health check; the previous version keeps serving"
  compose logs --no-color --tail 100 "api-$idle" || true
  compose stop "api-$idle" || true
  compose rm -f "api-$idle" || true
  [ -n "$(image_of "$active")" ] && set_var "API_IMAGE_${idle^^}" "$(image_of "$active")"
  alert "Deploy failed: the previous version keeps serving" "The new image $target failed its health check in slot api-$idle and was stopped. api-$active keeps serving."
  exit 1
fi
