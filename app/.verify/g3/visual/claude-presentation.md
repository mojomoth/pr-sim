Warning: this sign-in ends between 2026-11-15 and 2026-11-18 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.
The mobile capture follows the draft's overall section order and copy. The main differences are in sizing: the timer and the judge row are much smaller than the draft. The desktop iPhone frame has no hard breakage. I ignored user data (slide content, transcript text, judge names and faces) and the green fake-camera feed in the self-view, which is test media.

## Mobile vs draft

### P1
1. **Timer is much smaller.** In the draft, `03:42` is the biggest element on the screen: about 110px tall in a very heavy black weight. The actual `04:44` is about 50px tall and only bold. It no longer anchors the screen.
2. **Judge row is shrunk and centered.** In the draft, three square tiles (about 238px each) fill the full width edge to edge. The actual tiles are about 168px, grouped in the middle with about 115px of empty space on each side. The photos are full color, which is correct.

### P2
3. **Header order.** In the draft, the back chevron and the PR·SIM logo share the top row, and the "발표 중" row holds only the title and the 종료 pill. In the actual screen, the logo sits alone on top and the chevron has moved down to the title row.
4. **종료 pill.** The draft has a thin light-gray border and is shorter (about 125×65). The actual pill has a dark/black border and is taller (about 120×87).
5. **"발표 남은 시간" label.** It is smaller and lighter gray than in the draft (draft: about 30px, mid-gray).
6. **Progress bar fill may be reversed.** At 04:44 remaining the bar is about 95% filled, so it appears to show time *remaining*. The draft's fill (about 40% at 03:42) reads like time *elapsed*. Please check which one is intended.
7. **Slide card width and slide corners.** In the draft, the gray card is wider than the content column (about 18px side margins against 40px elsewhere), and the slide image fills the card width with square corners. In the actual screen, the card uses the normal 48px margins and the slide is a rounded, padded inner panel.
8. **Self-camera ("나") preview.** The draft preview is landscape (about 4:3), has a thin white border, and hangs over the bottom edge of the slide. The actual preview is portrait (about 3:4), has no border, and sits fully inside the slide.
9. **Slide controls.** The draft uses small (about 56px) light-gray circles, with the group shifted left of center. The actual buttons are large (about 88px) white circles in a centered group, and the "3 / 12" counter is larger and bolder.
10. **Waveform.** The draft shows thin bars with varying heights and a symmetric envelope. The actual bars are thick, solid black and close to the same height, which looks much heavier.
11. **"· 음성 인식 중".** The draft sets it in regular weight, dark gray; the actual text is a lighter gray.
12. **Transcript bubble.** The actual text is larger (about 32px against 26px) and ends with a blinking caret `|` that the draft doesn't have.
13. **Extra divider line.** A full-width hairline above the 마이크/카메라 row, at the top of the sticky bottom bar, is not in the draft.
14. **마이크 켜짐 / 카메라 켜짐 pills.** In the draft they are shorter (about 70px), narrower and inset, with lighter labels. The actual pills are about 95px tall, run to the full content width, and use larger semibold labels.
15. **"발표 마치기 →" button.** The draft button is wider than the content margins, about 86px tall, with a moderate radius (about 20px). The actual button is inset to 48px margins, about 112px tall, and more pill-shaped (radius about 40px).

## Desktop iPhone frame
- **No overflow:** nothing spills past the bezel. The bottom bar (the divider, the 마이크/카메라 pills and the "발표 마치기" button) sits fully inside the screen, with about 30px left above the bottom edge.
- **Corners:** the screen corners look clipped correctly. The app background is white, so a bleed into the bezel would be hard to see in this capture.
- **Dynamic Island:** it doesn't collide with anything. The logo starts below it.
- **P2:** the judge-name labels (y≈709) almost touch the bottom bar's divider (y≈716), with no breathing room. It looks like the scroll area ends exactly at the bar, so on a slightly shorter screen the labels would be hidden under it. Adding bottom padding equal to the bar's height to the scroll content would fix this.
- **P2:** the frame keeps the same proportions as the mobile capture, so the small timer and the centered judge tiles (about 78px each) look even more undersized here.
