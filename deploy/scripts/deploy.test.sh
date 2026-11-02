#!/usr/bin/env bash
# Tests the control flow of deploy.sh with a fake `docker` command: a healthy release switches
# slots (Caddy sends new requests to it) and stops the old one only after that, once Caddy has no
# request in flight to it (#71); a release that fails its health check is removed, the old slot
# keeps serving, the Owner is alerted, and deploy.sh exits non-zero. Also that every deploy sets
# up the image store (storage-init.sh): the Backup's read-only key is imported once, with its
# secret on stdin only, and a deploy stops before starting anything when that fails. Caddy
# reloads its Caddyfile on every deploy; Garage restarts only when garage.toml changed.
# Run: bash deploy/scripts/deploy.test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/stack/scripts" "$tmp/bin"
cp "$here/deploy.sh" "$here/storage-init.sh" "$tmp/stack/scripts/"
mkdir -p "$tmp/stack/garage"
echo 'replication_factor = 1' > "$tmp/stack/garage/garage.toml"
backup_key=GK0123456789abcdef01234567
backup_secret=$(printf 'ab%.0s' {1..32})
printf 'IMAGES_BACKUP_KEY_ID=%s\nIMAGES_BACKUP_SECRET_KEY=%s\n' "$backup_key" "$backup_secret" > "$tmp/stack/.env"

# The fake docker: logs every call; `compose up --wait api-X` fails when X's image contains "broken".
# Garage knows the Backup's key once it was imported (the file $FAKE_DIR/key, holding stdin).
# Caddy's admin API reports one request in flight to the slot named in $FAKE_DIR/busy, for as many
# more polls as the number after it; it cannot be reached while $FAKE_DIR/no-admin exists, nor at
# any other address (as at localhost:2019, which busybox wget tries as ::1). Stopping a slot also
# logs which slot Caddy sends requests to.
cat > "$tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
echo "docker $*" >> "$DOCKER_LOG"
if [[ " $* " == *" exec -T caddy wget "* ]]; then
  [[ " $* " == *" http://127.0.0.1:2019/reverse_proxy/upstreams "* ]] && [ ! -f "$FAKE_DIR/no-admin" ] || exit 1
  busy=none left=0
  if [ -f "$FAKE_DIR/busy" ]; then read -r busy left < "$FAKE_DIR/busy"; fi
  out=
  for slot in api-blue api-green; do
    n=0
    if [ "$slot" = "$busy" ] && [ "$left" -gt 0 ]; then n=1; fi
    out+="${out:+,}{\"address\":\"$slot:3000\",\"num_requests\":$n,\"fails\":0}"
  done
  if [ "$left" -gt 0 ]; then echo "$busy $((left - 1))" > "$FAKE_DIR/busy"; fi
  echo "[$out]"
  exit 0
fi
if [ "$1" = compose ] && [[ " $* " == *" stop api-"* ]]; then
  echo "routing: $([ -e state/api-slot/green ] && echo green || echo blue)" >> "$DOCKER_LOG"
fi
if [[ " $* " == *" /garage key info "* ]]; then [ -f "$FAKE_DIR/key" ]; exit; fi
if [[ " $* " == *" /garage json-api ImportKey - "* ]]; then cat > "$FAKE_DIR/key"; exit 0; fi
if [ "$1" = compose ] && [[ " $* " == *" --wait "* ]]; then
  slot=${*: -1}
  key="API_IMAGE_$(tr a-z A-Z <<<"${slot#api-}")"
  image=$(grep -E "^$key=" state/images.env | tail -1 | cut -d= -f2-)
  [[ "$image" == *broken* ]] && exit 1
fi
exit 0
FAKE
chmod +x "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH" DOCKER_LOG="$tmp/docker.log" FAKE_DIR="$tmp"
unset DRAIN_SECONDS
cd "$tmp/stack"

fail() { echo "FAIL: $*"; echo "--- docker calls"; cat "$DOCKER_LOG"; exit 1; }
deploy() { : > "$DOCKER_LOG"; ./scripts/deploy.sh "$1" > "$tmp/out.log" 2>&1; }
# The Caddy admin API polls before `compose stop api-$1`.
polls_before_stop() { sed -n "/compose .* stop api-$1\$/q;p" "$DOCKER_LOG" | grep -c "exec -T caddy wget" || true; }

deploy ghcr.io/x/app:v1 || fail "first deploy should succeed"
[ "$(cat state/active)" = blue ] || fail "first deploy goes to blue"
[ ! -e state/api-slot/green ] || fail "Caddy sends the first deploy's requests to blue"
grep -q "compose .* up -d db garage caddy" "$DOCKER_LOG" || fail "the image store is started with the database"
grep -q "\"secretAccessKey\":\"$backup_secret\"" "$tmp/key" || fail "the Backup's key is imported"
grep -q "$backup_secret" "$DOCKER_LOG" && fail "the secret must not appear on a command line"
grep -q "compose .* exec -T garage /garage bucket allow --read rodokmen-images --key $backup_key" "$DOCKER_LOG" || fail "the Backup's key may read the bucket"
grep -q "compose .* exec -T garage /garage bucket deny --write --owner rodokmen-images --key $backup_key" "$DOCKER_LOG" || fail "the Backup's key may not write"
grep -q "compose .* restart garage" "$DOCKER_LOG" && fail "Garage is not restarted on the first deploy"
echo 'compression_level = "none"' >> garage/garage.toml

echo "api-blue 3" > "$tmp/busy"
deploy ghcr.io/x/app:v2 || fail "second deploy should succeed"
[ -e state/api-slot/green ] || fail "after the switch Caddy sends new requests to green"
grep -A1 "compose .* stop api-blue$" "$DOCKER_LOG" | grep -q "routing: green" || fail "the old slot is stopped only after the switch"
[ "$(polls_before_stop blue)" -eq 4 ] || fail "the old slot is stopped once Caddy has no request in flight to it, not before"
grep -q "ImportKey" "$DOCKER_LOG" && fail "an existing key is not imported again"
grep -q "compose .* restart garage" "$DOCKER_LOG" || fail "Garage restarts when garage.toml changed"
[ "$(cat state/active)" = green ] || fail "second deploy switches to green"
[ "$(cat state/previous)" = ghcr.io/x/app:v1 ] || fail "previous image recorded"
grep -q "compose .* stop api-blue" "$DOCKER_LOG" || fail "old slot stopped after the switch"
grep -q "^WATCHDOG_IMAGE=ghcr.io/x/app:v2$" state/images.env || fail "watchdog follows the release"
grep -q "^MCP_IMAGE=ghcr.io/x/app:v2$" state/images.env || fail "the MCP server follows the release"
grep -q "compose .* up -d --no-deps watchdog mcp" "$DOCKER_LOG" || fail "the MCP server is restarted with the release"
grep -q "compose .* exec -T caddy caddy reload" "$DOCKER_LOG" || fail "Caddy reads its Caddyfile again"

rm state/api-slot/green # as a deploy.sh from before the switch file left it
if deploy ghcr.io/x/app:v3-broken; then fail "a broken release must fail the deploy"; fi
[ -e state/api-slot/green ] || fail "Caddy keeps sending new requests to the serving slot"
grep -A1 "compose .* stop api-blue$" "$DOCKER_LOG" | grep -q "routing: green" || fail "Caddy never sends requests to the broken slot"
grep -q "compose .* restart garage" "$DOCKER_LOG" && fail "Garage is not restarted when garage.toml is unchanged"
[ "$(cat state/active)" = green ] || fail "the old slot stays active"
grep -q "compose .* stop api-blue" "$DOCKER_LOG" || fail "the broken slot is stopped"
grep -q "compose .* rm -f api-blue" "$DOCKER_LOG" || fail "the broken slot is removed"
grep -q "compose .* stop api-green" "$DOCKER_LOG" && fail "the serving slot must not be stopped"
grep -q "compose .* exec -T api-green node dist/cli.js alert --subject Deploy failed" "$DOCKER_LOG" || fail "the Owner is alerted from the serving slot"
grep -q "previous version keeps serving" "$tmp/out.log" || fail "the log says so"

deploy rollback || fail "rollback should succeed"
[ "$(cat state/active)" = blue ] || fail "rollback starts the previous image in the idle slot"
grep -q "^API_IMAGE_BLUE=ghcr.io/x/app:v1$" state/images.env || fail "rollback uses the previous image"
[ ! -e state/api-slot/green ] || fail "after the rollback Caddy sends new requests to blue"
grep -A1 "compose .* stop api-green$" "$DOCKER_LOG" | grep -q "routing: blue" || fail "the old slot is stopped only after the switch back"

cp .env env.good
echo "IMAGES_BACKUP_KEY_ID=not-a-key" >> .env
if deploy ghcr.io/x/app:v4; then fail "a deploy without a valid Backup key must fail"; fi
grep -q "compose .* up -d --no-deps --wait" "$DOCKER_LOG" && fail "no slot is started when the image store is not ready"
[ "$(cat state/active)" = blue ] || fail "the serving slot stays active"
grep -q "alert --subject Deploy failed: the image store is not ready" "$DOCKER_LOG" || fail "the Owner is alerted"
mv env.good .env

echo "api-blue 1000" > "$tmp/busy"
DRAIN_SECONDS=1 deploy ghcr.io/x/app:v5 || fail "a deploy completes when the old slot stays busy"
grep -q "api-blue: 1 requests still in flight through Caddy after 1s; stopping it anyway" "$tmp/out.log" || fail "the log says the old slot stopped while busy"
grep -q "compose .* stop api-blue$" "$DOCKER_LOG" || fail "the old slot is stopped after DRAIN_SECONDS"
[ "$(cat state/active)" = green ] || fail "the new slot serves"

touch "$tmp/no-admin"
DRAIN_SECONDS=1 deploy ghcr.io/x/app:v6 || fail "a deploy completes when Caddy's admin API cannot be read"
grep -q "api-green: an unknown number of requests still in flight through Caddy after 1s" "$tmp/out.log" || fail "the log says the in-flight requests were unknown"
[ "$(polls_before_stop green)" -eq 4 ] || fail "without an answer from Caddy, the old slot is given DRAIN_SECONDS"
rm "$tmp/no-admin"

echo "deploy.sh: switch, drain, failed health check, rollback, configuration reload and image store setup behave as specified"
