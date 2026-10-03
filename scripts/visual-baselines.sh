#!/usr/bin/env bash
#
# Regenerate the visual baselines on Linux.
#
# Screenshot baselines are platform-specific: macOS and Linux rasterise text
# differently enough that a Mac-generated PNG can never pass on CI. CI runs
# ubuntu-latest, so Linux is the single reference platform (see
# snapshotPathTemplate in playwright.config.js).
#
# Usage:
#   npm run test:visual:update              # regenerate every baseline
#   npm run test:visual:update -- -g letter # just the matching tests
set -euo pipefail

"$(dirname "${BASH_SOURCE[0]}")/playwright-docker.sh" --project=visual --update-snapshots "$@"

echo
echo "Done. Review the diff, then commit tests/__screenshots__/."
