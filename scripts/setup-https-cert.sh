#!/usr/bin/env bash
# Generate a self-signed cert for the project domain so the dev server can serve HTTPS.
#
#   npm run cert
#
# Blocks SSO sets a Secure, domain-scoped cookie — it is never stored on http://localhost,
# so local dev has to run on the real domain over HTTPS.

set -euo pipefail
cd "$(dirname "$0")/.."

# Git Bash rewrites arguments that look like Unix paths, which turns openssl's
# `/CN=host` subject into `C:/Program Files/Git/CN=host`. Turn that off.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

[ -f .env.local ] && { set -a; . ./.env.local; set +a; }
DOMAIN="${VITE_DEV_DOMAIN:-dfqfhj.slsblx.com}"
PORT="${VITE_DEV_PORT:-5173}"

mkdir -p .cert

# The SAN must contain the exact domain — modern browsers ignore CN entirely.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 \
  -keyout .cert/dev-key.pem -out .cert/dev-cert.pem \
  -subj "/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

echo
echo "✓ Certificate written to .cert/ for $DOMAIN"
echo
echo "Two manual steps remain (both need Administrator):"
echo
echo "  1. Point the domain at this machine — add to"
echo "     C:\\Windows\\System32\\drivers\\etc\\hosts :"
echo
echo "       127.0.0.1  $DOMAIN"
echo
echo "  2. Trust the certificate (optional — you can also click through the warning):"
echo
echo "       certutil -addstore -f Root .cert\\dev-cert.pem"
echo
echo "Then: npm run dev  →  https://$DOMAIN:$PORT"
