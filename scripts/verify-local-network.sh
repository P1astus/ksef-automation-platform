#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: $0 <server-LAN-IP-or-hostname>" >&2
  echo "Run this from another LAN device; using the server's LAN IP on the host is a weaker fallback." >&2
  exit 2
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v nc >/dev/null 2>&1 || { echo "nc (netcat) is required" >&2; exit 1; }

for port in 80 443; do
  nc -z -w 3 "$TARGET" "$port" || { echo "FAIL: $TARGET:$port is not reachable" >&2; exit 1; }
done

headers="$(curl -fsSI --max-time 10 "http://$TARGET/")"
printf '%s\n' "$headers" | head -1 | grep -Eq ' 308 '
printf '%s\n' "$headers" | grep -Eiq "^location: https://$TARGET/"

# A private CA or the generated certificate may not yet be trusted on the probe
# machine, so connectivity uses -k. Browser trust is a separate install step.
https_status="$(curl -ksS --max-time 10 -o /dev/null -w '%{http_code}' "https://$TARGET/")"
case "$https_status" in
  2??|3??) ;;
  *) echo "FAIL: HTTPS returned $https_status" >&2; exit 1 ;;
esac

for port in 3000 5432 5433 5678 8090; do
  if nc -z -w 2 "$TARGET" "$port" >/dev/null 2>&1; then
    echo "FAIL: internal port $port is reachable on $TARGET" >&2
    exit 1
  fi
done

echo "OK: only HTTPS 443 and HTTP-to-HTTPS redirect 80 are exposed by the KSeF stack on $TARGET"
