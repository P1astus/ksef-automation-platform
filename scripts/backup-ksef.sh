#!/usr/bin/env bash
# Daily backup of everything that cannot be rebuilt from git:
#   - ksef_platform DB   (firms, clients, invoices, offline24 deadlines, ...)
#   - n8n DB             (workflows, credentials, execution history)
#   - ocr_uploads volume (source documents - subject to tax-retention rules)
#   - secrets archive    (.env incl. N8N_ENCRYPTION_KEY, portal/.env.local, certificates/)
#
# Without N8N_ENCRYPTION_KEY a restored n8n database has unreadable credentials,
# which is why the secrets archive is part of the backup, not an afterthought.
#
# Config (env vars, all optional):
#   BACKUP_DIR                    default: <repo>/backups
#   BACKUP_RETENTION_DAYS         default: 30
#   BACKUP_ENCRYPT_PASSPHRASE_FILE  if set, secrets.tgz is AES-256 encrypted with it
#   BACKUP_OFFSITE_CMD            run after a verified backup with $BACKUP_RUN_DIR set,
#                                 e.g. 'rclone copy "$BACKUP_RUN_DIR" remote:ksef-backups/$(basename "$BACKUP_RUN_DIR")'
#   BACKUP_ALERT_URL              POSTed a JSON {message} on failure (e.g. 01-send-alert webhook)
#
# Cron (host, 03:00 daily):
#   0 3 * * * /path/to/ksef-platform/scripts/backup-ksef.sh >> /path/to/backups/backup.log 2>&1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$BACKUP_DIR/$STAMP"

log() { echo "[$(date '+%F %T')] $*"; }

alert() {
  if [ -n "${BACKUP_ALERT_URL:-}" ]; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      -d "{\"message\":\"KSeF backup FAILED on $(hostname): $*\"}" "$BACKUP_ALERT_URL" \
      || log "could not deliver failure alert to BACKUP_ALERT_URL"
  fi
}

fail() {
  log "BACKUP FAILED: $*"
  rm -rf "$RUN_DIR"   # never leave a partial run that looks complete
  alert "$*"
  exit 1
}
trap 'fail "unexpected error at line $LINENO"' ERR

# Written by us, so a partial run is never mistaken for a complete one.
umask 077
mkdir -p "$RUN_DIR"

log "dumping ksef_platform"
docker exec ksef_db pg_dump -U ksef_app ksef_platform | gzip > "$RUN_DIR/ksef_platform.sql.gz"

log "dumping n8n"
docker exec n8n_postgres pg_dump -U n8n n8n | gzip > "$RUN_DIR/n8n.sql.gz"

log "archiving ocr_uploads"
docker exec ksef_portal tar -C /app/uploads -czf - . > "$RUN_DIR/ocr_uploads.tgz"

log "archiving secrets"
SECRET_PATHS=()
for p in .env portal/.env.local certificates; do
  [ -e "$REPO_DIR/$p" ] && SECRET_PATHS+=("$p")
done
[ ${#SECRET_PATHS[@]} -gt 0 ] || fail "no secrets found to archive (.env missing?)"
if [ -n "${BACKUP_ENCRYPT_PASSPHRASE_FILE:-}" ]; then
  tar -C "$REPO_DIR" -czf - "${SECRET_PATHS[@]}" \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$BACKUP_ENCRYPT_PASSPHRASE_FILE" \
    > "$RUN_DIR/secrets.tgz.enc"
else
  log "WARNING: BACKUP_ENCRYPT_PASSPHRASE_FILE not set - secrets.tgz is UNENCRYPTED; do not ship off-site as is"
  tar -C "$REPO_DIR" -czf "$RUN_DIR/secrets.tgz" "${SECRET_PATHS[@]}"
fi

# A backup that was never checked is a hope, not a backup.
log "verifying"
gzip -t "$RUN_DIR/ksef_platform.sql.gz" "$RUN_DIR/n8n.sql.gz"
tar -tzf "$RUN_DIR/ocr_uploads.tgz" > /dev/null
grep -q 'CREATE TABLE public.invoices' <(gunzip -c "$RUN_DIR/ksef_platform.sql.gz") \
  || fail "ksef_platform dump has no invoices table"
[ "$(wc -c < "$RUN_DIR/ksef_platform.sql.gz")" -gt 1024 ] || fail "ksef_platform dump suspiciously small"
[ "$(wc -c < "$RUN_DIR/n8n.sql.gz")" -gt 1024 ] || fail "n8n dump suspiciously small"

( cd "$RUN_DIR" && shasum -a 256 -- * > SHA256SUMS )
log "ok: $RUN_DIR ($(du -sh "$RUN_DIR" | cut -f1))"

if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
  log "running off-site hook"
  # The local backup is good at this point - keep it, but do not stay quiet.
  if ! BACKUP_RUN_DIR="$RUN_DIR" bash -c "$BACKUP_OFFSITE_CMD"; then
    log "OFF-SITE HOOK FAILED (local backup kept at $RUN_DIR)"
    alert "off-site upload failed, local backup kept at $RUN_DIR"
    exit 1
  fi
fi

# Rotate only after this run fully succeeded, and only timestamped dirs.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??????-??????' -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
log "done"
