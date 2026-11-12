Warning: this sign-in ends between 2026-11-15 and 2026-11-18 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.
I couldn't run a pixel-diff script because the shell command needed approval, so these measurements are by eye from the 780×1688 captures and are only good to about ±4px.

## Mobile (`01-landing-mobile.png`) vs draft (`01-landing.png`)

The capture is a very close match. I found no P1 issues: nothing is missing, extra, reordered or broken. Every Korean string matches the draft exactly: 연습 기록, 발표 시뮬레이터, the 3-line headline, the 2-line subtitle, 시작하기, and 상황 설정부터 피드백까지, 한 번에.

### P1
None.

### P2 (minor)
1. **Logo is too small.** In the draft the logo mark plus "PR·SIM" wordmark spans about x 53–307 and y 45–122 (≈254×77). In the capture it spans about x 48–254 and y 48–112 (≈206×64), so it's roughly 18–20% smaller and sits about 5px further left. This is the most visible difference.
2. **Top half sits slightly high.** The 연습 기록 pill (36 vs 40), eyebrow (227 vs 232), headline (≈318 vs 325) and subtitle lines (570/618 vs 578/626) are all 4–8px higher than in the draft. The pill's size and radius match.
3. **Eyebrow text is a bit wider.** The text runs about x 318–488 versus 326–483 in the draft, and the dot sits further left (295 vs 302). Letter-spacing or size is slightly larger; the weight looks the same.
4. **CTA is about 4px lower.** The capture has it at y 1452–1580 versus 1448–1576 in the draft. The 시작하기 label starts at x 96 instead of 100, and the arrow circle sits about 2px right and 4px lower. Height, radius, colours and the black arrow circle match.
5. **Everything else matches**: the hero spotlight and podium image (same crop, same position, grayscale as in the draft), the dark gradient fade behind the CTA, the footer caption's position and size (y ≈1620), and the headline weight and size.

The landing screen has no judge photos, so the full-colour rule doesn't apply. The grayscale hero image is correct per the draft.

## Desktop phone frame (`01-landing-desktop.png`, 1440×900)

The frame has no problems:
- **No overflow past the bezel.** All content stays inside the screen area (about x 540–900). The spotlight fixture is cut off at the right screen edge, the same way it is cut off at the canvas edge in the draft.
- **Bottom bar is inside the screen.** The CTA (y ≈745–803) and the caption (y ≈822) sit above the bottom bezel, with about 35px to spare before the screen's lower edge.
- **Corners and top are clean.** The screen corners look rounded and clipped, though the black app background against the black bezel makes this hard to confirm by eye. The header starts below the Dynamic Island (island bottom ≈82, header top ≈91), so they don't collide.
- **The layout scales proportionally.** It's the same layout as the mobile capture scaled to ~0.46×, with element positions matching within about 2px, so no frame-only reflow bugs.
- **No home indicator is drawn** at the bottom of the screen. That's only cosmetic; flag it if the frame mockup is supposed to include one.

The only fix worth making is item 1 (logo size). Items 2–4 are within a few pixels and optional.
