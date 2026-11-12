import assert from "node:assert/strict";
import { test } from "node:test";
import { SentenceAssembler } from "@/features/stt/sentences";

test("splits punctuated sentences and carries the unfinished tail", () => {
  const a = new SentenceAssembler();
  assert.deepEqual(a.push("안녕하세요. 저희 팀은", false), ["안녕하세요."]);
  assert.equal(a.pending, "저희 팀은");
  assert.deepEqual(a.push("시뮬레이터를 소개합니다."), ["저희 팀은 시뮬레이터를 소개합니다."]);
  assert.equal(a.pending, "");
});

test("several sentences in one chunk come out separately", () => {
  const a = new SentenceAssembler();
  assert.deepEqual(a.push("첫째입니다. 둘째인가요? 셋째예요!"), ["첫째입니다.", "둘째인가요?", "셋째예요!"]);
});

test("an unpunctuated tail with a final ending is complete when the chunk closed at a pause", () => {
  const a = new SentenceAssembler();
  assert.deepEqual(a.push("매출이 두 배로 늘었습니다"), ["매출이 두 배로 늘었습니다"]);
  assert.equal(a.pending, "");
});

test("a noun ending in 요 is not taken as the end of a sentence", () => {
  const a = new SentenceAssembler();
  assert.deepEqual(a.push("가장 중요"), []);
  assert.equal(a.pending, "가장 중요");
});

test("flush emits the carry once, reset drops it", () => {
  const a = new SentenceAssembler();
  a.push("그래서 저희는", false);
  assert.deepEqual(a.flush(), ["그래서 저희는"]);
  assert.deepEqual(a.flush(), []);
  a.push("남은 말", false);
  a.reset();
  assert.equal(a.pending, "");
});

test("preview shows the carry + interim text without consuming it", () => {
  const a = new SentenceAssembler();
  a.push("끝났습니다. 다음은", false);
  const p = a.preview("시장 규모");
  assert.deepEqual(p.complete, []);
  assert.equal(p.rest, "다음은 시장 규모");
  assert.equal(a.pending, "다음은");
});
