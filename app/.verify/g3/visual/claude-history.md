Warning: this sign-in ends between 2026-11-15 and 2026-11-18 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.
# 07 History: actual build vs. draft

The overall structure matches the draft: logo, hero, two stat tiles, filter chips, session cards, and a bottom call-to-action. The page is grayscale, which is correct. There are no judge photos on this screen, so the full-color rule doesn't apply.

## P1: clearly different from the draft

1. **The profile button is missing.** The draft has a round light-gray button with a person icon at the top right, across from the logo. The actual header shows only the logo.
2. **The hero headline is too small and too light.** In the draft, "달라지는 발표." spans about 62% of the screen width in Black/ExtraBold weight, roughly 38–40px on a 390-wide screen. The actual one spans about 39% (around 26px) in Bold. That makes it about 1.5× smaller, so it doesn't carry the screen the way the draft does.

## P2: minor

3. **The subtitle is weaker.** "나의 시뮬레이션 기록" is smaller and lighter gray than in the draft, which uses about #555 at a noticeably larger size.
4. **The stat tile labels are too faint.** "총", "회", "평균" and "점" are small and light gray. In the draft they are larger and dark, about #333, so they read as a set with the number.
5. **Controls are taller than in the draft.**
   - Stat tiles: about 18.6% of the width (draft about 13%).
   - Filter chips: about 11% (draft about 8.5%).
   - Card buttons: about 12% (draft about 9%).

   Together these make the page noticeably longer than the draft.
6. **The page margins differ.** In the draft, the cards and bottom button are wider (about 22px margin) than the stat tiles (about 36px). In the actual build everything uses the same margin of about 42px. The actual version is more consistent, so this may be fine.
7. **Each card has a "삭제" link at the top right.** It isn't in the draft. It's a functional addition and sits fine.
8. **Each finished card has a feedback line ("수치로 답변의 신뢰를 높여요.").** It isn't in the draft and makes each card taller.
9. **Card titles are cut off early.** "시드 투자 이후 Pre-A 라…" truncates at about 55% of the card width because of the score column. That's partly the real data, but the title gets very little width.
10. **The in-progress card is laid out differently.** The draft has one full-width "이어하기 →" button. The actual card has a half-width button plus "질의응답 01:00 남음" on the right. It's a deliberate addition, but it is visibly different from the draft.
11. **The "진행 중" badge is a darker gray** (about #666) than in the draft, which uses a lighter gray (about #999).
12. **The "다시 시작하기" outline button text is bold black.** In the draft it is medium weight and dark gray, so it looks secondary next to the filled button.
13. **The "+ 새 시뮬레이션" button text is smaller** than in the draft: about 3.6% of the width versus about 4.25%.

## Desktop capture (iPhone frame)

- **No P1 frame problems.** Nothing overflows past the bezel, the corners are clipped properly, the dynamic island doesn't cover the logo, and the side margins are even (about 21px). The bottom "새 시뮬레이션" button sits fully inside the screen, above the bottom bezel.
- **P2: scrolling content stops at a hard edge.** The second card is cut off with a straight horizontal line at about y=768, just above the bottom button. There's no fade or gradient into the button area. In the full mobile capture the fade is there, so the fade may only be missing inside the frame.
- **P2: a stray shadow under the bottom button.** At about y=845 there is a faint gray smudge under the left half of the button only (x≈575–740). It looks like an off-center shadow showing in the gap above the bottom bezel.
