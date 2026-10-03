#!/usr/bin/env bash
#
# Run Playwright inside the official image matching the installed
# @playwright/test, on Linux — the reference platform for visual baselines and
# the way to run engines (WebKit, Firefox) not installed on this machine.
#
# node_modules is shadowed by a named Docker volume: the host tree holds macOS
# binaries, and letting the container install over the bind mount would leave
# the host with Linux ones. The volume is refreshed whenever package-lock.json
# changes.
#
# Usage:
#   scripts/playwright-docker.sh --project=webkit
#   scripts/playwright-docker.sh --project=visual --update-snapshots
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PW_VERSION="$(node -p "require('${REPO}/node_modules/@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
VOLUME="bp-writingtool-node-modules"

if ! docker info >/dev/null 2>&1; then
  echo "error: the Docker daemon is not running." >&2
  echo "       Start Docker Desktop and re-run, or let CI run it." >&2
  exit 1
fi

echo "Running Playwright in ${IMAGE}: $*"
docker run --rm \
  -v "${REPO}":/work \
  -v "${VOLUME}":/work/node_modules \
  -w /work \
  -e CI="${CI:-}" \
  "${IMAGE}" \
  bash -c '
    set -euo pipefail
    stamp=node_modules/.package-lock.sha
    want="$(sha256sum package-lock.json | cut -d" " -f1)"
    if [ ! -x node_modules/.bin/playwright ] || [ "$(cat "$stamp" 2>/dev/null)" != "$want" ]; then
      npm ci --no-audit --no-fund
      echo "$want" > "$stamp"
    fi
    npx playwright test "$@"
  ' _ "$@"
