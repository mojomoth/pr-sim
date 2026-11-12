#!/usr/bin/env bash
# Copies the generated fixtures into public/fixtures so the dev server serves them at /fixtures/*. Run from pocs/.
set -euo pipefail
mkdir -p public/fixtures/audio
cp fixtures/presentation.pdf fixtures/proposal.pdf fixtures/presentation-script.txt fixtures/sample-session.json public/fixtures/
cp fixtures/audio/* public/fixtures/audio/
echo "synced fixtures -> public/fixtures"
