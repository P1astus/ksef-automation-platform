#!/usr/bin/env bash
# Restores a backup's ksef_platform dump into a throwaway Postgres container and
# compares row counts against the live database. Never touches the live DB.
# Usage: scripts/verify-backup.sh [backup-run-dir]   (default: newest in $BACKUP_DIR)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
RUN_DIR="${1:-$(ls -1d "$BACKUP_DIR"/20??????-?????? | tail -1)}"
SCRATCH="ksef_restore_check_$$"

cleanup() { docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "verifying $RUN_DIR"
( cd "$RUN_DIR" && shasum -a 256 -c SHA256SUMS )

docker run -d --name "$SCRATCH" -e POSTGRES_PASSWORD=scratch postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$SCRATCH" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$SCRATCH" psql -U postgres -qc "CREATE ROLE ksef_app SUPERUSER LOGIN" -c "CREATE DATABASE ksef_platform OWNER ksef_app" >/dev/null

# ON_ERROR_STOP: a restore that half-works must fail loudly.
gunzip -c "$RUN_DIR/ksef_platform.sql.gz" \
  | docker exec -i "$SCRATCH" psql -U ksef_app -d ksef_platform -q -v ON_ERROR_STOP=1 >/dev/null

COUNT_SQL="SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.' || quote_ident(table_name), false, true, '')))[1]::text
           FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1"
restored="$(docker exec "$SCRATCH" psql -U ksef_app -d ksef_platform -Atc "$COUNT_SQL")"
live="$(docker exec ksef_db psql -U ksef_app -d ksef_platform -Atc "$COUNT_SQL")"

echo "restored tables: $(echo "$restored" | wc -l | tr -d ' ')"
if [ "$restored" = "$live" ]; then
  echo "OK: every table's row count matches the live DB"
else
  # Live keeps changing between backup and check, so show the diff, don't hide it.
  echo "row counts differ from live (expected if data changed since the backup):"
  diff <(echo "$restored") <(echo "$live") || true
fi
