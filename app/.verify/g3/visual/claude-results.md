Warning: this sign-in ends between 2026-11-15 and 2026-11-18 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.
I compared the three images by eye only. My Python crop and colour-sampling command wasn't approved, so colour values, radii and size ratios below are visual estimates, not measured pixels. Neither image has judge photos, so the colour-photo rule doesn't apply to this screen.

## Mobile (actual vs draft)

### P1
1. **An internal model ID is shown to users.** Under the meta pill there is an extra line: `평가 모델 openai:gpt-6-astra · 2026. 11. 13. 오전 2:41`. The draft has nothing here, and the raw `provider:model` string reads like debug output. Remove it, or hide it behind a dev flag.
2. **The bottom area doesn't match the draft.** The draft puts the CTA and "기록으로 돌아가기" straight after the meta pill, with no divider. The actual screen has a full-width hairline divider above a separate bottom bar, a bigger gap above the CTA, and the extra model line pushing it further down.

### P2
3. **The hero title is smaller and lighter.** "한 번 더, / 더 좋은 발표로." is about 6% of screen width tall versus about 7.8% in the draft, and its weight is Bold rather than the draft's very heavy Black.
4. **The subtitle looks different.** The draft has one short, darker, medium-weight line. The actual subtitle wraps to two lines in a lighter regular weight. Wrapping comes from the user's data, but the weight and colour are lighter than the draft.
5. **The score number is about 25% smaller.** "68" is roughly 16% of width tall versus about 21% for the draft's "82", so the score card is noticeably shorter and the number has less presence. "/ 100" and the caption below are placed correctly.
6. **The card greys are flatter.** In the draft the score card is a slightly darker grey (about #EBEBEB) than the sub-score tiles. In the actual screen every card is the same very light grey (about #F4F4F4), so the score card doesn't stand out.
7. **There are 4 sub-score tiles instead of 3** ("자료 품질 55" is added). The tiles are narrower, but the labels and numbers keep the draft's look. This is fine if it's an intended product change.
8. **There's an extra "발표 총평" card** between the sub-scores and "잘한 점". It's not in the draft, but it's styled consistently with the other cards.
9. **"다음 연습에서는" uses a different layout.** The actual card is a numbered list (outlined ①②③, a bold title, then grey body text). The draft is a single plain sentence. It's richer than the draft, and the grey body text is noticeably lighter.
10. **The meta pill separators are cramped.** The actual uses `5분 · 질의응답 3분 · 질문 4개` with a tight "·". The draft uses a wider "・" with more space around it.
11. **The CTA button is less rounded.** Its radius looks like about 20px, while the draft is close to a full pill. The label "상세 피드백 보기 →" is also slightly smaller and lighter than the draft.
12. The logo, back chevron, "종합 결과" title, "기록" pill, check icons and "잘한 점" heading all match the draft closely.

## Desktop (iPhone mockup frame)

### P1
1. **Content shows through the bottom bar.** Behind "기록으로 돌아가기" (around y 785–845) you can see the faint outline of the card scrolling underneath. The bar seems to have a translucent or gradient background instead of solid white, so the link sits on top of ghosted content and looks broken. The bar needs a solid background.

### P2
2. **No iOS status bar.** There's no time or battery row beside the Dynamic Island, so the area above the logo is empty. There's also no home indicator at the bottom. These are cosmetic.
3. **Placement checks pass.**
   - **Edges:** nothing overflows the bezel on any side.
   - **Bottom bar:** it sits fully inside the screen, with the link about 40px above the curved bottom edge.
   - **Corners:** the screen corners are properly rounded and clipped.
   - **Top:** the logo starts clear of the Dynamic Island.

**Top fixes:** remove the model/date line (mobile P1 #1), make the bottom-bar background solid (desktop P1), and bring the hero title and score number back up toward the draft's weight and size (P2 #3 and #5).
