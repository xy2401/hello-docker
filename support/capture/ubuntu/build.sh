#!/usr/bin/env bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
engine=${ENGINE:-podman}
case "$engine" in podman|docker) ;; *) echo 'ENGINE must be podman or docker' >&2; exit 2;; esac
export BASE_IMAGE=${BASE_IMAGE:-localhost/hello-capture/ubuntu:26.04}
export BUILDAH_FORMAT=docker
export PODMAN_COMPOSE_PROVIDER=${PODMAN_COMPOSE_PROVIDER:-podman-compose}
"$engine" compose -f "$here/compose.yaml" build ubuntu
"$engine" image inspect "$BASE_IMAGE" --format '{{.Id}}'
