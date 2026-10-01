#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required for the build-context verification." >&2
  exit 2
}

# cacheonly leaves no runnable image or pushed artifact behind, while --no-cache
# forces the COPY/RUN assertions to observe the current .dockerignore state.
exec docker buildx build \
  --no-cache \
  --progress=plain \
  --output=type=cacheonly \
  --file "$script_dir/Dockerfile.context-probe" \
  "$repository_root"
