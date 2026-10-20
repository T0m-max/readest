#!/bin/sh
set -eu
server_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec docker compose --project-directory "$server_dir" \
  --env-file "${READEST_ENV_FILE:-$server_dir/.env.server.local}" \
  -f "$server_dir/compose.yaml" "$@"
