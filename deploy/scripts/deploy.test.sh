#!/usr/bin/env bash
# Tests the control flow of deploy.sh with a fake `docker` command: a healthy release switches
# slots and stops the old one; a release that fails its health check is removed, the old slot
# keeps serving, the Owner is alerted, and deploy.sh exits non-zero. Run: bash deploy/scripts/deploy.test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/stack/scripts" "$tmp/bin"
cp "$here/deploy.sh" "$tmp/stack/scripts/"
touch "$tmp/stack/.env"

# The fake docker: logs every call; `compose up --wait api-X` fails when X's image contains "broken".
cat > "$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
echo "docker $*" >> "$DOCKER_LOG"
if [ "$1" = compose ] && [[ " $* " == *" --wait "* ]]; then
  slot=${*: -1}
  key="API_IMAGE_$(tr a-z A-Z <<<"${slot#api-}")"
  image=$(grep -E "^$key=" state/images.env | tail -1 | cut -d= -f2-)
  [[ "$image" == *broken* ]] && exit 1
fi
exit 0
FAKE
chmod +x "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH" DOCKER_LOG="$tmp/docker.log"
cd "$tmp/stack"

fail() { echo "FAIL: $*"; echo "--- docker calls"; cat "$DOCKER_LOG"; exit 1; }
deploy() { : > "$DOCKER_LOG"; ./scripts/deploy.sh "$1" > "$tmp/out.log" 2>&1; }

deploy ghcr.io/x/app:v1 || fail "first deploy should succeed"
[ "$(cat state/active)" = blue ] || fail "first deploy goes to blue"

deploy ghcr.io/x/app:v2 || fail "second deploy should succeed"
[ "$(cat state/active)" = green ] || fail "second deploy switches to green"
[ "$(cat state/previous)" = ghcr.io/x/app:v1 ] || fail "previous image recorded"
grep -q "compose .* stop api-blue" "$DOCKER_LOG" || fail "old slot stopped after the switch"
grep -q "^WATCHDOG_IMAGE=ghcr.io/x/app:v2$" state/images.env || fail "watchdog follows the release"
grep -q "^MCP_IMAGE=ghcr.io/x/app:v2$" state/images.env || fail "the MCP server follows the release"
grep -q "compose .* up -d --no-deps watchdog mcp" "$DOCKER_LOG" || fail "the MCP server is restarted with the release"
grep -q "compose .* exec -T caddy caddy reload" "$DOCKER_LOG" || fail "Caddy reads its Caddyfile again"

if deploy ghcr.io/x/app:v3-broken; then fail "a broken release must fail the deploy"; fi
[ "$(cat state/active)" = green ] || fail "the old slot stays active"
grep -q "compose .* stop api-blue" "$DOCKER_LOG" || fail "the broken slot is stopped"
grep -q "compose .* rm -f api-blue" "$DOCKER_LOG" || fail "the broken slot is removed"
grep -q "compose .* stop api-green" "$DOCKER_LOG" && fail "the serving slot must not be stopped"
grep -q "compose .* exec -T api-green node dist/cli.js alert --subject Deploy failed" "$DOCKER_LOG" || fail "the Owner is alerted from the serving slot"
grep -q "previous version keeps serving" "$tmp/out.log" || fail "the log says so"

deploy rollback || fail "rollback should succeed"
[ "$(cat state/active)" = blue ] || fail "rollback starts the previous image in the idle slot"
grep -q "^API_IMAGE_BLUE=ghcr.io/x/app:v1$" state/images.env || fail "rollback uses the previous image"

echo "deploy.sh: switch, failed health check and rollback behave as specified"
