#!/usr/bin/env bash
# Sets up the image store, Garage (docker-compose.yml, service garage). Idempotent: deploy.sh
# runs it on every deploy, and it is safe to run by hand at any time.
#
# Garage itself lays out its one node and creates the bucket and the API's key (S3_ACCESS_KEY_ID,
# S3_SECRET_ACCESS_KEY in .env) on first start. This script waits until it is healthy, checks
# the bucket, and gives the Backup job its own key, which may only read the bucket
# (IMAGES_BACKUP_KEY_ID, IMAGES_BACKUP_SECRET_KEY in .env).
#
# Garage never reuses a key id, even after the key is deleted. To change the Backup's key, put a
# new id and secret in .env, run this again, then delete the old key:
#   docker compose --env-file .env exec garage /garage key delete --yes <old id>
set -Eeuo pipefail
cd "$(dirname "$0")/.."

BUCKET=rodokmen-images
IMAGES=state/images.env
mkdir -p state
touch "$IMAGES"

compose() { docker compose --env-file .env --env-file "$IMAGES" "$@"; }
garage() { compose exec -T garage /garage "$@"; }
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
env_value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }

key_id=$(env_value IMAGES_BACKUP_KEY_ID)
secret=$(env_value IMAGES_BACKUP_SECRET_KEY)
[[ "$key_id" =~ ^GK[0-9a-f]{24}$ ]] || { log "IMAGES_BACKUP_KEY_ID in .env must be GK followed by 24 hex digits (see .env.example)"; exit 1; }
[[ "$secret" =~ ^[0-9a-f]{64}$ ]] || { log "IMAGES_BACKUP_SECRET_KEY in .env must be 64 hex digits (see .env.example)"; exit 1; }

compose up -d --wait --wait-timeout 120 garage
garage bucket info "$BUCKET" >/dev/null || { log "Garage has no bucket $BUCKET; it creates it on first start (GARAGE_DEFAULT_BUCKET)"; exit 1; }

if garage key info "$key_id" >/dev/null 2>&1; then
  log "the Backup's key $key_id exists"
else
  log "importing the Backup's key $key_id"
  # On stdin, so that the secret never shows in a process list.
  printf '{"accessKeyId":"%s","secretAccessKey":"%s","name":"backup (read-only)"}' "$key_id" "$secret" |
    garage json-api ImportKey - >/dev/null
fi
garage bucket allow --read "$BUCKET" --key "$key_id" >/dev/null
garage bucket deny --write --owner "$BUCKET" --key "$key_id" >/dev/null
log "image store ready: bucket $BUCKET, read-only Backup key $key_id"
