#!/usr/bin/env bash
# Refresh /ui/screens thumbnails (public/ui/drafts/*.jpg, 400px wide) from docs/screens/draft/*.png.
# Run from pocs/ whenever the draft PNGs are re-rendered (e.g. with the approved black BI logo).
# Also prints whether each draft still equals the archived pre-approved-BI version.
set -euo pipefail
cd "$(dirname "$0")/../.."
src=../docs/screens/draft
for f in 01-landing 02-setup 03-presentation 04-review 05-results 06-feedback 07-history; do
  sips -s format jpeg -s formatOptions 80 --resampleWidth 400 "$src/$f.png" --out "public/ui/drafts/$f.jpg" >/dev/null
  if [ -f "$src/archive/pre-approved-bi/$f.png" ] && cmp -s "$src/$f.png" "$src/archive/pre-approved-bi/$f.png"; then
    echo "$f: synced (still pre-approved-BI render)"
  else
    echo "$f: synced (new render)"
  fi
done
