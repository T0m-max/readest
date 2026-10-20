#!/bin/sh
# Prefer reachable mirrors, then retain only the canonical local image tag.
set -eu
server_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
images=$("$server_dir/compose.sh" config --images)
client_image=$("$server_dir/compose.sh" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["client"]["image"])')
for image in $images; do
  [ "$image" = "$client_image" ] && continue
  case "$image" in
    quay.io/*) mirror="quay.nju.edu.cn/${image#quay.io/}" ;;
    */*) mirror="dockerproxy.net/$image" ;;
    *) mirror="dockerproxy.net/library/$image" ;;
  esac
  if docker pull "$mirror"; then
    docker tag "$mirror" "$image"
    docker image rm "$mirror"
  else
    printf 'Mirror unavailable; trying upstream: %s\n' "$image" >&2
    docker pull "$image"
  fi
done
