#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TLS_DIR="${LOCAL_TLS_DIR:-$REPO_DIR/certificates/local}"
PRIMARY_NAME="${1:-}"

if [ -z "$PRIMARY_NAME" ]; then
  echo "Usage: $0 <LAN-hostname-or-IP> [additional-hostname-or-IP ...]" >&2
  exit 2
fi

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
mkdir -p "$TLS_DIR"
umask 077

san_for() {
  case "$1" in
    *:*) printf 'IP:%s' "$1" ;;
    *[!0-9.]*) printf 'DNS:%s' "$1" ;;
    *) printf 'IP:%s' "$1" ;;
  esac
}

SANS="DNS:localhost,IP:127.0.0.1"
for name in "$@"; do
  SANS="$SANS,$(san_for "$name")"
done

openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 825 \
  -keyout "$TLS_DIR/tls.key" \
  -out "$TLS_DIR/tls.crt" \
  -subj "/CN=$PRIMARY_NAME/O=KSeF Local" \
  -addext "subjectAltName=$SANS" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" \
  >/dev/null 2>&1

chmod 600 "$TLS_DIR/tls.key"
chmod 644 "$TLS_DIR/tls.crt"
echo "Created $TLS_DIR/tls.crt with subjectAltName=$SANS"
echo "Install tls.crt as a trusted certificate on every LAN workstation before browsing."
