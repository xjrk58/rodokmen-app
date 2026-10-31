#!/usr/bin/env bash
# Nightly Backup (operations spec, "Nightly encrypted Backups"): the database (pg_dump) and
# every image (a copy of the bucket), encrypted and deduplicated by restic into a repository
# at a second EU provider. Keeps 30 daily and 12 monthly snapshots.
#
# At the end it writes STATUS_FILE, successful or not; the watchdog reads it and alerts the
# Owner when a Backup failed or none succeeded for 26 hours.
#
# Environment:
#   PGHOST PGUSER PGPASSWORD PGDATABASE    the production database
#   RESTIC_REPOSITORY RESTIC_PASSWORD      the repository (initialised once with `restic init`)
#   AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY  credentials of an S3-compatible repository
#   IMAGES_SOURCE                          the image bucket as an rclone remote (docker-compose.yml
#                                          defines the remote "images" with RCLONE_CONFIG_IMAGES_*), or a directory
#   WORK_DIR (/work)  STATUS_FILE (/status/backup.json)  BACKUP_HOST (rodokmen)
set -Eeuo pipefail

WORK_DIR=${WORK_DIR:-/work}
STATUS_FILE=${STATUS_FILE:-/status/backup.json}
BACKUP_HOST=${BACKUP_HOST:-rodokmen}
HERE=$(cd "$(dirname "$0")" && pwd)
started=$(date -u +%FT%TZ)
snapshot=""
LOG=$(mktemp)
RCLONE_CONFIG=$(mktemp)
export RCLONE_CONFIG
trap 'rm -f "$LOG" "$RCLONE_CONFIG"' EXIT
exec 2> >(tee -a "$LOG" >&2)

json_string() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/}
  s=${s//$'\t'/ }
  printf '"%s"' "$s"
}

write_status() {
  local ok=$1 error=${2:-}
  mkdir -p "$(dirname "$STATUS_FILE")"
  printf '{"ok":%s,"startedAt":"%s","finishedAt":"%s","snapshot":%s,"error":%s}\n' \
    "$ok" "$started" "$(date -u +%FT%TZ)" \
    "$([ -n "$snapshot" ] && json_string "$snapshot" || echo null)" \
    "$([ -n "$error" ] && json_string "$error" || echo null)" > "$STATUS_FILE.tmp"
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

fail() {
  trap - ERR
  local message="$1"
  sleep 0.2 # let tee flush stderr
  local tail_lines
  tail_lines=$(tail -n 5 "$LOG" 2>/dev/null || true)
  echo "Backup failed: $message" >&2
  write_status false "$message"$'\n'"$tail_lines"
  exit 1
}
# shellcheck disable=SC2154 # rc is set inside the trap
trap 'rc=$?; fail "step \"$BASH_COMMAND\" (line $LINENO) exited with status $rc"' ERR

need() { [ -n "${!1:-}" ] || fail "$1 is not set"; }
for v in PGHOST PGUSER PGDATABASE RESTIC_REPOSITORY RESTIC_PASSWORD IMAGES_SOURCE; do need "$v"; done

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

restic cat config >/dev/null || fail "the restic repository cannot be opened (not initialised, wrong password, or unreachable)"

rm -rf "$WORK_DIR/db"
mkdir -p "$WORK_DIR/db" "$WORK_DIR/images"

# Dump and count inside one snapshot, so the counts describe exactly what the dump holds.
log "dumping the database"
coproc PSQL { psql -qAtX -v ON_ERROR_STOP=1; }
echo "begin isolation level repeatable read read only; select pg_export_snapshot();" >&"${PSQL[1]}"
read -r -t 30 pg_snapshot <&"${PSQL[0]}" || fail "could not open a database snapshot"
pg_dump --snapshot="$pg_snapshot" --format=custom --no-owner --file "$WORK_DIR/db/rodokmen.dump"
echo "\\i $HERE/counts.sql" >&"${PSQL[1]}"
read -r -t 60 table_counts <&"${PSQL[0]}" || fail "could not count records"
table_counts=$(tr -d ' ' <<<"$table_counts")
echo "commit;" >&"${PSQL[1]}"
eval "exec ${PSQL[1]}>&-"
wait "$PSQL_PID" 2>/dev/null || true

log "copying images from $(sed -E 's/(access_key_id|secret_access_key)=[^,:]*/\1=***/g' <<<"$IMAGES_SOURCE")"
rclone sync "$IMAGES_SOURCE" "$WORK_DIR/images" --checksum --stats-one-line --stats 0
image_files=$(find "$WORK_DIR/images" -type f | wc -l | tr -d ' ')

printf '{"takenAt":"%s","tables":%s,"imageFiles":%s}\n' "$started" "$table_counts" "$image_files" > "$WORK_DIR/db/counts.json"

log "writing the restic snapshot"
summary=$(restic backup --host "$BACKUP_HOST" --tag nightly --json "$WORK_DIR/db" "$WORK_DIR/images" | tail -n 1)
snapshot=$(grep -oE '"snapshot_id":"[0-9a-f]+"' <<<"$summary" | cut -d'"' -f4)
[ -n "$snapshot" ] || fail "restic did not report a snapshot"

log "applying retention: 30 daily, 12 monthly"
restic forget --host "$BACKUP_HOST" --tag nightly --keep-daily 30 --keep-monthly 12 --prune
restic check

tables=$(grep -oE '"[a-z_]+":[0-9]+' <<<"$table_counts" | wc -l || true)
log "Backup $snapshot done: $tables tables, $image_files images"
write_status true
