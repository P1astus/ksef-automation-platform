#!/usr/bin/env bash
# Complete local-edition backup: application DB, uploaded source documents,
# certificates, and the .env that contains the keys required to decrypt them.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
LOCAL_COMPOSE_PROJECT="${LOCAL_COMPOSE_PROJECT:-ksef-automation-platform}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$REPO_DIR/.env}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$BACKUP_DIR/$STAMP"

dc() {
  docker compose --env-file "$LOCAL_ENV_FILE" -p "$LOCAL_COMPOSE_PROJECT" \
    -f "$REPO_DIR/docker-compose.yml" -f "$REPO_DIR/docker-compose.local.yml" "$@"
}

umask 077
mkdir -p "$RUN_DIR"
touch "$RUN_DIR/.incomplete"
trap 'echo "Backup incomplete: $RUN_DIR" >&2' ERR

[ -f "$LOCAL_ENV_FILE" ] || { echo "Missing $LOCAL_ENV_FILE" >&2; exit 1; }
[ "$(basename "$LOCAL_ENV_FILE")" = ".env" ] || { echo "LOCAL_ENV_FILE must be named .env so restore is unambiguous" >&2; exit 1; }
[ -d "$REPO_DIR/certificates" ] || { echo "Missing $REPO_DIR/certificates" >&2; exit 1; }

echo "Backing up ksef_platform from Compose project $LOCAL_COMPOSE_PROJECT"
dc exec -T ksef_db pg_dump -U ksef_app ksef_platform | gzip > "$RUN_DIR/ksef_platform.sql.gz"

echo "Backing up ocr_uploads"
dc exec -T portal tar -C /app/uploads -czf - . > "$RUN_DIR/ocr_uploads.tgz"

echo "Backing up .env and certificates"
if [ -n "${BACKUP_ENCRYPT_PASSPHRASE_FILE:-}" ]; then
  tar -C "$(dirname "$LOCAL_ENV_FILE")" -czf - .env -C "$REPO_DIR" certificates \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$BACKUP_ENCRYPT_PASSPHRASE_FILE" \
    > "$RUN_DIR/secrets.tgz.enc"
else
  echo "WARNING: secrets.tgz is unencrypted; keep the backup on encrypted storage" >&2
  tar -C "$(dirname "$LOCAL_ENV_FILE")" -czf "$RUN_DIR/secrets.tgz" .env -C "$REPO_DIR" certificates
fi

gzip -t "$RUN_DIR/ksef_platform.sql.gz"
tar -tzf "$RUN_DIR/ocr_uploads.tgz" >/dev/null
gunzip -c "$RUN_DIR/ksef_platform.sql.gz" | grep -q 'CREATE TABLE public.schema_migrations'
unlink "$RUN_DIR/.incomplete"
(
  cd "$RUN_DIR"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS
)

echo "Backup complete: $RUN_DIR"
