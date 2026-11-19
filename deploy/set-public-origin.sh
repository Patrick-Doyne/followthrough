#!/usr/bin/env bash
# Reads the tunnel's current public address from the ft-tunnel journal (or
# takes one as the argument), writes it to /etc/followthrough/api.env as
# FT_PUBLIC_ORIGIN and restarts the API so CORS and the upload URLs use it.
#
#   sudo deploy/set-public-origin.sh                     # from the tunnel log
#   sudo deploy/set-public-origin.sh https://example.com # explicit
set -euo pipefail

ENV_FILE=/etc/followthrough/api.env
ORIGIN="${1:-}"

if [ -z "$ORIGIN" ]; then
  ORIGIN="$(journalctl -u ft-tunnel --no-pager 2>/dev/null \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
fi
if [ -z "$ORIGIN" ]; then
  echo "No public origin found: is ft-tunnel running? (systemctl status ft-tunnel)" >&2
  exit 1
fi

touch "$ENV_FILE"
if grep -q '^FT_PUBLIC_ORIGIN=' "$ENV_FILE"; then
  sed -i "s#^FT_PUBLIC_ORIGIN=.*#FT_PUBLIC_ORIGIN=$ORIGIN#" "$ENV_FILE"
else
  echo "FT_PUBLIC_ORIGIN=$ORIGIN" >> "$ENV_FILE"
fi
systemctl restart ft-api
echo "Public origin: $ORIGIN"
echo "Open $ORIGIN on the phone once the API is back (about 20 s): curl -s $ORIGIN/api/v1/actuator/health"
