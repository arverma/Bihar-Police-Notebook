#!/usr/bin/env bash
#
# Regenerate the visual baselines on Linux.
#
# Screenshot baselines are platform-specific: macOS and Linux rasterise text
# differently enough that a Mac-generated PNG can never pass on CI. CI runs
# ubuntu-latest, so Linux is the single reference platform (see
# snapshotPathTemplate in playwright.config.js) and this runs the Playwright
# image matching the installed @playwright/test.
#
# node_modules is shadowed by a named Docker volume: the host tree holds macOS
# binaries, and letting the container install over the bind mount would leave
# the host with Linux ones.
#
# Usage:
#   npm run test:visual:update              # regenerate every baseline
#   npm run test:visual:update -- -g letter # just the matching tests
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PW_VERSION="$(node -p "require('${REPO}/node_modules/@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
VOLUME="bp-writingtool-node-modules"

if ! docker info >/dev/null 2>&1; then
  echo "error: the Docker daemon is not running." >&2
  echo "       Start Docker Desktop and re-run, or let CI regenerate them." >&2
  exit 1
fi

echo "Regenerating Linux baselines in ${IMAGE}"
docker run --rm \
  -v "${REPO}":/work \
  -v "${VOLUME}":/work/node_modules \
  -w /work \
  "${IMAGE}" \
  bash -c '
    set -euo pipefail
    if [ ! -x node_modules/.bin/playwright ]; then
      npm ci --no-audit --no-fund
    fi
    npx playwright test --project=visual --update-snapshots "$@"
  ' _ "$@"

echo
echo "Done. Review the diff, then commit tests/__screenshots__/."
