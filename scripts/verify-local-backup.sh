#!/usr/bin/env bash
# Restore a local backup into a throwaway Compose project, run the real
# migration image, restore uploads/secrets, and decrypt one stored credential.
# The live project and its volumes are never addressed.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
RUN_DIR="${1:-$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??????-??????' | sort | tail -1)}"
VERIFY_PROJECT="${LOCAL_VERIFY_PROJECT:-ksef_verify_$$}"
RESTORE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ksef-local-restore.XXXXXX")"

case "$VERIFY_PROJECT" in
  ksef_verify*) ;;
  *) echo "Refusing non-verification project name: $VERIFY_PROJECT" >&2; exit 2 ;;
esac

cleanup() {
  dc down --volumes --remove-orphans >/dev/null 2>&1 || true
  find "$RESTORE_DIR" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

[ -n "$RUN_DIR" ] && [ -d "$RUN_DIR" ] || { echo "Backup directory not found" >&2; exit 2; }
(
  cd "$RUN_DIR"
  shasum -a 256 -c SHA256SUMS
)

if [ -f "$RUN_DIR/secrets.tgz.enc" ]; then
  [ -n "${BACKUP_ENCRYPT_PASSPHRASE_FILE:-}" ] || { echo "BACKUP_ENCRYPT_PASSPHRASE_FILE is required" >&2; exit 2; }
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$BACKUP_ENCRYPT_PASSPHRASE_FILE" \
    -in "$RUN_DIR/secrets.tgz.enc" | tar -C "$RESTORE_DIR" -xzf -
else
  tar -C "$RESTORE_DIR" -xzf "$RUN_DIR/secrets.tgz"
fi

RESTORED_ENV="$RESTORE_DIR/.env"
[ -s "$RESTORED_ENV" ] || { echo "Restored .env is missing" >&2; exit 1; }
[ -d "$RESTORE_DIR/certificates" ] || { echo "Restored certificates directory is missing" >&2; exit 1; }
[ -n "$(find "$RESTORE_DIR/certificates" -type f -print -quit)" ] || { echo "Restored certificates directory is empty" >&2; exit 1; }

dc() {
  docker compose --env-file "$RESTORED_ENV" -p "$VERIFY_PROJECT" \
    -f "$REPO_DIR/docker-compose.yml" -f "$REPO_DIR/docker-compose.local.yml" "$@"
}

dc up -d --no-deps ksef_db
for _ in $(seq 1 60); do
  dc exec -T ksef_db pg_isready -U ksef_app -d ksef_platform >/dev/null 2>&1 && break
  sleep 1
done
dc exec -T ksef_db pg_isready -U ksef_app -d ksef_platform >/dev/null

gunzip -c "$RUN_DIR/ksef_platform.sql.gz" \
  | dc exec -T ksef_db psql -v ON_ERROR_STOP=1 -U ksef_app -d ksef_platform -q >/dev/null

migration_rows="$(dc exec -T ksef_db psql -U ksef_app -d ksef_platform -Atc 'SELECT COUNT(*) FROM schema_migrations')"
[ "$migration_rows" -gt 0 ] || { echo "schema_migrations was not restored" >&2; exit 1; }
migrate_output="$(dc run --rm ksef_migrate)"
printf '%s\n' "$migrate_output"
printf '%s\n' "$migrate_output" | grep -Eiq '\[migrate\] done: noop'
echo "No migrations to apply: restored schema_migrations is current"

# Starting a one-off portal command creates and mounts the isolated project's
# ocr_uploads volume without publishing a port or starting the application.
dc run --rm --no-deps --entrypoint sh portal -c 'tar -C /app/uploads -xzf -' \
  < "$RUN_DIR/ocr_uploads.tgz"
expected_uploads="$(tar -tzf "$RUN_DIR/ocr_uploads.tgz" | sed '/\/$/d' | sort)"
restored_uploads="$(dc run --rm --no-deps --entrypoint sh portal -c 'find /app/uploads -type f -print' | sed 's#^/app/uploads/##' | sort)"
expected_uploads="$(printf '%s\n' "$expected_uploads" | sed 's#^\./##')"
[ "$expected_uploads" = "$restored_uploads" ] || { echo "Restored upload listing differs" >&2; exit 1; }

credential_row="$(dc exec -T ksef_db psql -U ksef_app -d ksef_platform -AtF '|' -c \
  "SELECT id, ksef_token_encrypted FROM clients WHERE ksef_token_encrypted LIKE 'enc:v1:%' ORDER BY id LIMIT 1")"
[ -n "$credential_row" ] || { echo "No encrypted KSeF credential exists in the backup; cannot prove key restoration" >&2; exit 1; }
client_id="${credential_row%%|*}"
ciphertext="${credential_row#*|}"

credential_key="$(sed -n 's/^KSEF_CREDENTIALS_KEY=//p' "$RESTORED_ENV" | tail -1)"
credential_key="${credential_key%\"}"; credential_key="${credential_key#\"}"
credential_key="${credential_key%\'}"; credential_key="${credential_key#\'}"
[ -n "$credential_key" ] || { echo "KSEF_CREDENTIALS_KEY is missing from restored .env" >&2; exit 1; }

KSEF_CREDENTIALS_KEY="$credential_key" CLIENT_ID="$client_id" CIPHERTEXT="$ciphertext" node -e '
  const { createDecipheriv } = require("crypto");
  const raw = process.env.KSEF_CREDENTIALS_KEY;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("restored KSEF_CREDENTIALS_KEY is not 32 bytes");
  const parts = process.env.CIPHERTEXT.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") throw new Error("bad credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2], "base64"));
  decipher.setAAD(Buffer.from(`ksef-client:${process.env.CLIENT_ID}`, "utf8"));
  decipher.setAuthTag(Buffer.from(parts[3], "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(parts[4], "base64")), decipher.final()]);
  if (plain.length === 0) throw new Error("credential decrypted to an empty value");
'

echo "OK: DB, schema_migrations, ocr_uploads, certificates, .env, and KSEF_CREDENTIALS_KEY round-trip verified"
