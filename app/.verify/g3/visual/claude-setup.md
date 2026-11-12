Warning: this sign-in ends between 2026-11-15 and 2026-11-18 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.
I compared the mobile capture with the draft and checked the desktop iPhone mockup. I couldn't zoom into crops because the crop command wasn't approved, so I judged the mobile capture from its downscaled view (466px wide). All sizes below are estimates relative to screen width.

## P1: clearly different from the draft

1. **Judge card layout is different.** In the draft each card is one compact row: photo, divider, name and meta, then the three chips (친절함/빠셈/공격적), then a vertically centred ✕. In the build the chips drop to a second row under the name, and the ✕ sits at the top right. Each card ends up about 2× the draft's height relative to width, so the judge section takes roughly twice the space.
2. **The page is much longer overall.** The draft's height is about 2.5× its width; the build's is about 4.3×. It no longer reads as a near-single-screen form. The main causes are item 1, the extra elements listed under P2, and taller slider blocks.
3. **Slider sections take too much vertical space.** From the 발표 시간 label to the 질의응답 시간 label is about 0.39× the width in the build, against about 0.21× in the draft. The slider container is taller (about 0.155× width vs 0.094×). The 1분/20분 and 1분/15분 labels under each track add another line plus spacing.

## P2: minor

**Extra elements not in the draft:**
- `30 / 300` character counter under the 상황 field.
- Min/max labels under both sliders (also counted in P1 #3).
- `필수` tag after 발표 자료 and `선택` tag after 제안 자료.
- `교체` text button next to the ✕ on the file row, and `· 214KB` in the file meta.
- Helper line "자료 분석을 마쳤어요. 심사위원이 이 자료를 근거로 질문해요."
- Underlined link `샘플 자료로 해보기` to the right of the 제안 자료 heading.
- Grey count `3` after 심사위원.
- Footer note "성향에 따라 질문하는 말투와 강도가 달라져요. 심사위원은 최대 3명까지 둘 수 있어요." It also wraps badly, leaving "수 있어요." alone on the last line.

**Styling differences:**
- **Slider handle:** the draft uses a solid black dot. The build uses a black dot with a white ring and outline, and it looks larger.
- **−/+ buttons:** about 50% larger than the draft's relative to width.
- **Upload button:** the build uses an upload-arrow icon where the draft has `+`. The button is taller, with a larger corner radius (about 24px vs 14px), and a white fill where the draft is very light grey.
- **Bottom bar:** the build adds a grey divider line and a large white gap above "총 8분 · 심사위원 3명". The draft has neither.
- **CTA "발표 시작하기 →":** the label is smaller and lighter than the draft's heavy, large label (about 16px semibold vs about 20px+ bold at the same scale). The button itself is slightly taller.
- **Headline "어떤 발표를 / 준비하고 있나요?":** a similar size, but the draft is noticeably heavier (ExtraBold or Black vs Bold).
- **PR·SIM logo:** slightly smaller relative to the draft's.

**Copy note:** judge meta reads `50대 · 심사위원`, while the draft has `투자심사위원`. That's probably data, but check that the role label isn't hard-coded to the generic 심사위원.

**Judge photos:** these are full colour as required (skin tones and the orange sweater show). Photo size and circular crop match the draft. No issue.

**Matches the draft:** the header (back arrow, logo, 상황 설정, the `01 / 03` pill), the subtitle, the grey 상황 field, the `5분`/`3분` value weight, the file row's icon and bold filename, the `+ 추가` pill, the black selected chip with grey unselected chips, and the summary line.

## Desktop iPhone mockup (1440×900)

- **Overflow and clipping:** nothing overflows the bezel. Content stays within the screen's width, and the rounded screen corners clip correctly at the top and bottom. The header sits clear of the Dynamic Island.
- **Bottom bar:** it stays inside the screen. The CTA ends about 28px above the screen's bottom edge, so the rounded corners don't clip it.
- **P2: content shows through the bottom bar.** The bar's background is semi-transparent or blurred, so the scrolled content behind it bleeds through. You can see faint ghost text to the left of "총 8분 · 심사위원 3명" (around x 560–640, y 760) and again under the CTA (y about 845). Use an opaque white bar, or a stronger blur with a solid fill.
- **P2: no status bar or home indicator.** There's no time or battery row next to the Dynamic Island, so the top of the screen looks bare. Add one only if the mockup is meant to look realistic.
