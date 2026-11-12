#!/usr/bin/env bash
# Serialized `pnpm add` so parallel agents don't corrupt the lockfile.
# Usage: bash scripts/pnpm-add.sh [-D] pkg...
cd "$(dirname "$0")/.." || exit 1
LOCK=/tmp/pr-sim-pocs-pnpm.lock
for i in $(seq 1 180); do mkdir "$LOCK" 2>/dev/null && break; sleep 1; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
pnpm add "$@"
