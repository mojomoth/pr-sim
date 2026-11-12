Warning: this sign-in ends between 2026-11-15 and 2026-11-18 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.
I compared the mobile capture with the draft, then checked the desktop capture inside the iPhone frame. I ignored differences in user data (names, questions, answer text, timer values) and the Next.js "N" button.

## Mobile (`04-review-mobile-full.png`) vs. the draft

### P1: clearly different from the draft
1. **Timer is much smaller and lighter.** The draft shows `02:18` as the main element: very large (about 90px glyphs) in a black/heavy weight. The app shows `01:51` at roughly half that size in a semibold weight. The screen loses its focal point.
2. **Korean line breaks split words** in the answer bubble: "맞 / 습니다", "3분기 / 에", "세트 / 당". The draft breaks only between words. `word-break: keep-all` is probably missing on the transcript text, and possibly the question text too.

### P2: minor
3. **Progress bar is styled differently.** The draft bar is thick (about 20px), has a mid-gray fill and is inset from the card edges. The app bar is thin (about 10px), has a black fill and runs the full content width.
4. **Side margins are wider.** Cards fill about 92% of the width in the draft and about 88% in the app, so the photo and cards look narrower.
5. **The 종료 pill is taller and almost circular.** The draft has a shorter, wider pill.
6. **Timer label has extra copy:** "질의응답 남은 시간 · 이어하기". The draft says only "질의응답 남은 시간". If "이어하기" marks a resumed session, that may be intended.
7. **The status chip on the photo** has a dark, nearly opaque brown fill and a "·····" dot icon. The draft uses a translucent gray glass pill with a waveform icon. The different chip text ("답변 듣는 중" vs "질문 중") is just a different state, which is fine.
8. **New row not in the draft:** "질문을 다시 들을 수 있어요." plus a "질문 다시 듣기" button between the question card and the answer. It's a reasonable addition, but it pushes the answer bubble down.
9. **Answer bubble has no tail.** The draft has a speech-bubble tail at the bottom-right. The bubble text is also lighter than the draft's bold white text.
10. **Mic bar differs:**
    - The mic circle sits flush left; the draft insets it and makes it larger.
    - The waveform uses thick, evenly spaced bars; the draft uses thin lines of varying height that fade out on the right.
    - There's an extra "듣고 있어요" label on the right.
11. **CTA corners:** the app button is a full pill. The draft's "답변 완료 →" is a rounded rectangle with a smaller radius.
12. **Vertical rhythm is tighter.** There's less space between the timer, the bar and the photo than in the draft.

### Matches
- The judge photo is **full color**, with rounded corners and an aspect ratio close to the draft.
- The name chip (white pill, bold), the gray question card with its small label, the hint line "천천히, 핵심부터 답변해 보세요." and the black CTA with the arrow all match.

## Desktop iPhone frame (`04-review-desktop.png`)

### Frame
- **Corners clip correctly** at the top and bottom, nothing spills past the bezel, and the CTA sits inside the screen above the bottom curve.
- **P2: faint text shows below the CTA**, around y≈848 near the bottom curve. Scrolling content or the hint line is showing through under the bottom bar, which needs an opaque background or more bottom padding.
- **P2: the bottom bar's white panel and shadow** extend about 6px past the right content edge (to x≈885, while cards end at x≈879), so the bar doesn't line up with the cards.

### Content problems seen in this capture
- **P1: the judge photo is missing entirely.** The follow-up question card ("꼬리질문 · 1 / 2") comes straight after the progress bar. Either the follow-up state hides the photo or it collapses at this height. Either way, the screen loses its main element.
- **P1: the transcript repeats itself.** The bubble shows "네. 지금 원가가 스티로폼보다 높은 건 맞습니다… 2028년에는" about three times in a row. This looks like a speech-to-text bug where partial results get appended instead of replaced (probably `useSentenceTranscriber`), not a styling issue.
- **P2: the long bubble is cut off hard** at the bottom bar with no fade. The hint line "천천히, 핵심부터…" is pushed out of view.
- **P2: the PR·SIM logo is not visible** in the frame, although the mobile capture shows it. It's either hidden in frame mode or scrolled away under the header. Check which, and whether that's intended.
- **P2: the fallback message wraps tightly.** "지금은 음성을 만들 수 없어요. 질문은 글로 보고 이어 가세요." takes two lines in small gray text, crowded against the "질문 다시 듣기" button.
