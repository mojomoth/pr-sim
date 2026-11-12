#!/bin/zsh
# Usage: judge.sh <screen-name> <actual-png-abs> <draft-png-abs> [extra-actual-png-abs]
# Runs the Claude CLI as the visual judge (from the repo root) and saves claude-<screen>.md.
cd /Users/jyl/work/study/pr-sim || exit 1
name=$1; actual=$2; draft=$3; extra=$4
out=/Users/jyl/work/study/pr-sim/app/.verify/g3/visual/claude-$name.md
more=""
[[ -n $extra ]] && more=" Also read the desktop capture $extra (the app rendered inside an iPhone mockup frame on a 1440x900 desktop) and note any frame problems (overflow past the bezel, bottom bar outside the screen, corners not clipped)."
prompt="Compare the ACTUAL screenshot $actual with the DESIGN DRAFT $draft. List concrete visual deviations (layout order, spacing, sizes, typography weight/size, color, radius, missing/extra elements, Korean copy differences, color-vs-grayscale media) as P1 (clearly different from draft or broken) or P2 (minor). Note: the draft is an AI mock; real data differs — ignore content text differences of user data. Judge photos must be full color. The round 'N' button at the bottom-left is the Next.js dev-mode indicator (not part of the app) — ignore it.$more"
claude -p --allowedTools=Read -- "$prompt" > "$out" 2>&1
echo "$name exit $?"
