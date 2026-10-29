#!/usr/bin/env bash
# Monthly restore test (operations spec, "Monthly restore test"): restores the latest Backup,
# loads the dump into a scratch database, and checks that every table has the record count
# production had when the Backup was taken (stored with the dump), and that every image is
# there. Exits non-zero on any difference.
#
# Environment:
#   RESTIC_REPOSITORY RESTIC_PASSWORD (+ repository credentials)
#   PGHOST PGUSER PGPASSWORD         a throwaway PostgreSQL + PostGIS server (never production)
#   SCRATCH_DB (rodokmen_restore)  RESTORE_DIR (temporary)  BACKUP_HOST (rodokmen)
#   WORK_DIR (/work)                 the directory the Backup was taken from
#   EMPTY_TABLE                      optional: deliberately empty this table in the scratch
#                                    restore before comparing, to see the test fail
set -Eeuo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRATCH_DB=${SCRATCH_DB:-rodokmen_restore}
BACKUP_HOST=${BACKUP_HOST:-rodokmen}
WORK_DIR=${WORK_DIR:-/work}
RESTORE_DIR=${RESTORE_DIR:-$(mktemp -d)}
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

[[ "$SCRATCH_DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "bad SCRATCH_DB"; exit 2; }

log "restoring the latest snapshot into $RESTORE_DIR"
restic snapshots --host "$BACKUP_HOST" --tag nightly --latest 1
restic restore latest --host "$BACKUP_HOST" --tag nightly --target "$RESTORE_DIR"
root="$RESTORE_DIR$WORK_DIR"
[ -f "$root/db/rodokmen.dump" ] && [ -f "$root/db/counts.json" ] || { echo "the snapshot has no dump or counts under $WORK_DIR"; exit 1; }
expected=$(cat "$root/db/counts.json")

log "loading the dump into the scratch database $SCRATCH_DB"
dropdb --if-exists "$SCRATCH_DB"
createdb "$SCRATCH_DB"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$SCRATCH_DB" "$root/db/rodokmen.dump"

if [ -n "${EMPTY_TABLE:-}" ]; then
  [[ "$EMPTY_TABLE" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "bad EMPTY_TABLE"; exit 2; }
  log "deliberately emptying $EMPTY_TABLE in the scratch restore"
  psql -qX -v ON_ERROR_STOP=1 -d "$SCRATCH_DB" -c "truncate table public.\"$EMPTY_TABLE\" cascade"
fi

log "comparing record counts with production at Backup time"
differences=$(psql -qAtX -v ON_ERROR_STOP=1 -d "$SCRATCH_DB" -v expected="$expected" -F ' ' <<SQL
with expected as (
  select key as table_name, value::bigint as n from json_each_text((:'expected')::json -> 'tables')
), actual as (
  select key as table_name, value::bigint as n from json_each_text(($(grep -v '^--' "$HERE/counts.sql" | sed 's/;$//')))
)
select coalesce(e.table_name, a.table_name), coalesce(e.n::text, 'missing'), coalesce(a.n::text, 'missing')
from expected e full join actual a using (table_name)
where e.n is distinct from a.n
order by 1;
SQL
)
expected_images=$(grep -oE '"imageFiles":[0-9]+' <<<"$expected" | cut -d: -f2)
actual_images=$(find "$root/images" -type f 2>/dev/null | wc -l | tr -d ' ')
tables_json=$(grep -oE '"tables":\{[^}]*\}' <<<"$expected")
total=$(grep -oE '"[a-z_]+":[0-9]+' <<<"$tables_json" | awk -F: '{ s += $2 } END { print s + 0 }')
table_count=$(grep -oE '"[a-z_]+":[0-9]+' <<<"$tables_json" | wc -l | tr -d ' ')

status=0
if [ -n "$differences" ]; then
  echo "Record counts differ (table, production, restored):"
  sed 's/^/  /' <<<"$differences"
  status=1
fi
if [ "$expected_images" != "$actual_images" ]; then
  echo "Images differ: production had $expected_images, the restore has $actual_images"
  status=1
fi
if [ "${KEEP_SCRATCH:-}" != 1 ]; then dropdb --if-exists "$SCRATCH_DB"; fi
if [ "$status" -ne 0 ]; then
  echo "Restore test FAILED"
  exit 1
fi
echo "Restore test passed: $total records in $table_count tables and $actual_images images match the Backup of $(grep -oE '"takenAt":"[^"]+"' <<<"$expected" | cut -d'"' -f4)"
