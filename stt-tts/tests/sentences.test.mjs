// Unit tests for Korean sentence segmentation. Run: node --test stt-tts/tests/sentences.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences, SentenceAssembler, looksFinished, toSentences, joinChunks } from "../lib/sentences.ts";

test("splits on 다. 요. 까? and keeps the unfinished tail", () => {
  const r = splitSentences("안녕하세요. 저희 팀을 소개합니다. 질문 있으신가요? 그럼 저희");
  assert.deepEqual(r.complete, ["안녕하세요.", "저희 팀을 소개합니다.", "질문 있으신가요?"]);
  assert.equal(r.rest, "그럼 저희");
});
test("decimals, abbreviations and ?! runs are not boundaries", () => {
  assert.deepEqual(toSentences("매출이 3.5배 늘었습니다. A.I. 기술을 씁니다. 정말요?! 네."), ["매출이 3.5배 늘었습니다.", "A.I. 기술을 씁니다.", "정말요?!", "네."]);
});
test("quotative particles keep a quoted sentence inside its parent", () => {
  assert.deepEqual(toSentences('그는 "좋습니다." 라고 말했습니다. 끝.'), ['그는 "좋습니다." 라고 말했습니다.', "끝."]);
});
test("closing quotes / brackets stay with the sentence", () => {
  assert.deepEqual(toSentences("이건 핵심입니다.” 다음 장으로 가겠습니다."), ["이건 핵심입니다.”", "다음 장으로 가겠습니다."]);
});
test("unpunctuated long text falls back to sentence-final endings", () => {
  const r = splitSentences("저희는 친환경 포장재를 만듭니다 그리고 내년에 해외로 진출할 계획입니다 질문 있으신가요");
  assert.deepEqual(r.complete, ["저희는 친환경 포장재를 만듭니다", "그리고 내년에 해외로 진출할 계획입니다"]);
  assert.equal(r.rest, "질문 있으신가요");
});
test("assembler merges a sentence spoken across a pause", () => {
  const a = new SentenceAssembler();
  assert.deepEqual(a.push("안녕하세요. 저희 팀은"), ["안녕하세요."]);
  assert.equal(a.pending, "저희 팀은");
  assert.deepEqual(a.push("발표 연습 서비스를 만들었습니다. 이 서비스는"), ["저희 팀은 발표 연습 서비스를 만들었습니다."]);
  assert.deepEqual(a.push("서울에서 부산까지"), []);
  assert.equal(a.pending, "이 서비스는 서울에서 부산까지");
  assert.deepEqual(a.flush(), ["이 서비스는 서울에서 부산까지"]);
  assert.equal(a.pending, "");
});
test("closed chunk without punctuation is accepted if it ends like a sentence", () => {
  const a = new SentenceAssembler();
  assert.deepEqual(a.push("저희 팀은 발표를 시작하겠습니다", true), ["저희 팀은 발표를 시작하겠습니다"]);
  assert.deepEqual(a.push("그것보다", true), []);
  assert.ok(looksFinished("좋아요"));
  assert.ok(!looksFinished("바다"));
  assert.ok(!looksFinished("서울에서 부산까지"));
});
test("preview shows carry + interim split into sentences", () => {
  const a = new SentenceAssembler();
  a.push("오늘은 저희", true);
  assert.deepEqual(a.preview("서비스를 소개합니다. 먼저"), { complete: ["오늘은 저희 서비스를 소개합니다."], rest: "먼저" });
});
// --- review round 1: unpunctuated chunk ending in a 요/다/까-final noun, decimals/abbreviations cut by a pause
test("noun ending in 요 at a pause is carried, not emitted (중요/필요/수요/주요/개요)", () => {
  const cases = [
    [["이 부분이 정말 중요", "합니다."], ["이 부분이 정말 중요합니다."]],
    [["가장 필요", "한 것은 데이터입니다."], ["가장 필요한 것은 데이터입니다."]],
    [["시장 수요", "가 빠르게 늘고 있습니다."], ["시장 수요가 빠르게 늘고 있습니다."]],
    [["저희의 주요", "고객은 대학생입니다."], ["저희의 주요 고객은 대학생입니다."]],
    [["먼저 서비스 개요", "를 말씀드리겠습니다."], ["먼저 서비스 개요를 말씀드리겠습니다."]],
    [["작년보다", "두 배 성장했습니다."], ["작년보다 두 배 성장했습니다."]],
  ];
  for (const [chunks, want] of cases) {
    const a = new SentenceAssembler();
    const got = chunks.flatMap((c) => a.push(c, true));
    assert.deepEqual(got, want, chunks.join(" | "));
    assert.equal(a.pending, "");
  }
});
test("decimal / abbreviation split across chunks is re-joined", () => {
  for (const [chunks, want] of [
    [["매출이 3.", "5배 늘었습니다."], ["매출이 3.5배 늘었습니다."]],
    [["저희는 A.I.", "기술로 문제를 풉니다."], ["저희는 A.I. 기술로 문제를 풉니다."]],
    [["저희는 A.", "I. 기술로 문제를 풉니다."], ["저희는 A.I. 기술로 문제를 풉니다."]],
  ]) {
    const a = new SentenceAssembler();
    assert.deepEqual(chunks.flatMap((c) => a.push(c, true)), want, chunks.join(" | "));
  }
  // a stray "3." left at the very end still comes out on stop
  const a = new SentenceAssembler();
  assert.deepEqual(a.push("정답은 3.", true), []);
  assert.deepEqual(a.flush(), ["정답은 3."]);
});
test("real sentence-final bare endings are still accepted at a pause", () => {
  for (const w of ["이건 정말 좋다", "시장이 커진다", "매출이 늘었다", "그렇게 돼요", "한번 봐요", "제가 할게요", "이걸 어떻게 할까", "제 생각은 그래요", "아니요", "그럴걸요", "계획인데요"]) {
    assert.ok(looksFinished(w), w);
  }
  for (const w of ["이 부분이 중요", "가장 필요", "시장 수요", "주요", "서비스 개요", "작년보다", "부산 바다", "매일마다", "매출이 3.", "기술은 A.", "기술은 A.I."]) {
    assert.ok(!looksFinished(w), w);
  }
});
test("joinChunks keeps normal word boundaries", () => {
  assert.equal(joinChunks("저희 팀은", "한 가지 문제를"), "저희 팀은 한 가지 문제를");
  assert.equal(joinChunks("오늘은", "이 서비스를"), "오늘은 이 서비스를");
  assert.equal(joinChunks("", " 안녕하세요."), "안녕하세요.");
});
