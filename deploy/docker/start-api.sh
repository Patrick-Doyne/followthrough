#!/usr/bin/env bash
# Starts the REST API once the tunnel has a public address, which the API
# needs for CORS and for the upload URLs it hands the browser. The tunnel
# writes its log to /var/log/followthrough/tunnel.log; a fresh address
# appears there on every tunnel start. Without one after 90 s the API comes
# up on http://localhost (usable through an SSH port forward).
set -euo pipefail

ORIGIN=""
for _ in $(seq 1 90); do
  ORIGIN="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /var/log/followthrough/tunnel.log 2>/dev/null | tail -1 || true)"
  [ -n "$ORIGIN" ] && break
  sleep 1
done
ORIGIN="${ORIGIN:-http://localhost}"
echo "== API public origin: $ORIGIN"
echo "$ORIGIN" > /var/log/followthrough/public-origin

cd /app/springboot
# Uploads and finished live sessions are analysed by the real offline
# pipeline (cpp/follow-through-batch.cpp), built beside the live one, with
# the same engines. The stub processor the API defaults to invents numbers.
exec java -jar target/followthrough-api-0.0.1-SNAPSHOT.jar \
  --server.forward-headers-strategy=framework \
  --followthrough.cors.allowed-origins="$ORIGIN" \
  --followthrough.storage.local.base-url="$ORIGIN/api/v1" \
  --followthrough.processing.engine=cpp \
  --followthrough.cpp.binary-path=/app/cpp/build/follow_through_batch_gpu \
  --followthrough.cpp.working-directory=/app/cpp/build \
  --followthrough.node.working-directory=/app/follow-through-pro-19
