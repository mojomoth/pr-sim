# 04-review visual review (verify-2)
Sources: visual/current/04-review-{mobile,mobile-full,desktop,probe-live,probe-scrolled-end}.png vs docs/screens/draft/04-review.png + DESIGN.md. Measures: measurements-raw.json, crop.py output (device px, mobile 780w, draft 798w).

## recheck1 items
Mobile: 1 timer FIXED (336x86 = 43% w, heavy; draft 38%) | 2 line breaks FIXED | 3 progress bar FIXED (20px thick, gray 85 fill, inset x56-723) | 4 margins FIXED (card 91.8% vs 93.4%) | 5 end pill FIXED (124x72, ratio 1.72 vs draft 1.77) | 6 timer label "· 이어서 진행" ACCEPTED | 7 status chip STILL PRESENT/changed (compact row: solid black pill; full hero uses translucent) | 8 질문 다시 듣기 ACCEPTED (quiet text action in card label row) | 9 bubble tail+bold FIXED | 10 mic bar FIXED (inset circle, no 듣는 중 label) | 11 CTA radius FIXED (~24 vs draft ~28 device px) | 12 rhythm FIXED
Desktop: faint text FIXED | bar width FIXED (555-886 = cards) | photo under header FIXED as clipping, but replaced by compact avatar row (see NEW P1) | transcript repeat FIXED | long bubble FIXED | logo in frame ACCEPTED (scrolls away) but leaves a fragment (NEW P2) | fallback wrap FIXED (one line)
recheck1 new: stray line FIXED (rows 1370-1415 white) | tail FIXED (11px vs draft 12px) | mid-sentence start FIXED (top fade) | hint-to-mic gap FIXED (~48 vs ~40)

## NEW
P1: during answering at 390x844 (mobile + desktop frame) the large face card is replaced by a 56px avatar row (card 143 device px tall vs draft photo 573px); timer becomes the dominant element. Draft + DESIGN.md L96/L111/L127 require big color face card as focal point. Source: QaScreen.tsx compactHero (L692-709), JudgeCard.tsx JudgeHero compact.
P2: logo half-cut at top edge in default answering viewport (scrollTop 17 CSS px; logo ink rows y0-45).
P2: desktop frame shows a stray logo fragment dash under the island (x~557, y80-88).
P2: compact status pill solid black; three solid black masses (pill, bubble, CTA).
P2: 질문과 답변 기록 accordion (not in draft) below fold - acceptable.
Note: qa-probe ansBottom=0 at every sample, so hiddenPx=0 does not actually prove the answer bubble clears the bar; visually it does (bubble bottom 1311 < mic 1416).
