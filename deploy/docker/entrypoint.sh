#!/usr/bin/env bash
# Container entrypoint: make sure the engines exist for this GPU, then hand
# over to supervisord, which runs and restarts the six processes
# (deploy/docker/supervisord.conf).
set -euo pipefail

echo "== FollowThrough container starting"
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader || {
  echo "No GPU visible: run with the NVIDIA container toolkit (compose.yaml does)" >&2
  exit 1
}

build-engines.sh /app/python /var/lib/followthrough/engines

# The tunnel's address changes on every start and the logs live in a
# volume, so a previous run's address must not be mistaken for this one's.
: > /var/log/followthrough/tunnel.log
rm -f /var/log/followthrough/public-origin

: "${FOLLOWTHROUGH_JWT_SECRET:?FOLLOWTHROUGH_JWT_SECRET must be set (compose.yaml reads it from the env file)}"

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
