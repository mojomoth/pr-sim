#!/bin/zsh
# Usage: judge.sh <screen-name> <actual-png-abs> <draft-png-abs> <desktop-png-abs> <previous-report-abs>
# Claude CLI visual judge (recheck1), run from the repo root; saves claude-<screen>.md here.
cd /Users/jyl/work/study/pr-sim || exit 1
name=$1; actual=$2; draft=$3; desk=$4; prev=$5
out=/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/claude-$name.md
prompt="Compare the ACTUAL mobile screenshot $actual (390x844 @2x) with the DESIGN DRAFT $draft. First read the PREVIOUS review $prev and, for EACH previously reported P1/P2 item, state FIXED / STILL PRESENT / N/A with a one-line reason. Then list any NEW concrete visual deviations (layout order, spacing, sizes, typography weight/size, color, radius, missing/extra elements, Korean copy, color-vs-grayscale media) as P1 (clearly different from draft or broken) or P2 (minor). The draft is an AI mock; real user data differs — ignore user-data text differences. Judge photos, camera and slides must be FULL color (not washed out, not grayscale); UI chrome is monochrome. The round 'N' button bottom-left is the Next.js dev indicator — ignore it. Also read the desktop capture $desk (app inside an iPhone mockup on 1440x900) and note frame problems (overflow past the bezel, bottom bar outside the screen, corners not clipped, content bleeding through the bottom bar). End with a one-line verdict: count of P1 and P2."
claude -p --allowedTools=Read -- "$prompt" > "$out" 2>&1
echo "$name exit $?"
