// Unit tests for the deterministic speech metrics (no server, no LLM).
//   node --test report/tests/metrics.test.mjs        (from pocs/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSpeechMetrics, countSyllables, findFillers, countFillers } from "../lib/metrics.ts";

const S = (t, text, phase = "presentation") => ({ t, text, phase });
const words = (s) => findFillers(s).map((f) => `${f.kind === "hesitation" ? "H" : "B"}:${f.word}`);

test("countSyllables: Hangul + digits + % + latin", () => {
  assert.equal(countSyllables("안녕하세요."), 5);
  assert.equal(countSyllables("원가 118원"), 6); // 원가(2) + 118(3) + 원(1)
  assert.equal(countSyllables("83%"), 5); // 8,3 + 퍼센트(3)
  assert.equal(countSyllables("LOI 3건"), 4); // LOI≈2 + 3 + 건
});

test("findFillers: hesitations and habit words", () => {
  assert.deepEqual(words("음, 그러니까 이제 시작하겠습니다."), ["H:음", "B:그러니까", "B:이제"]);
  assert.deepEqual(words("어... 약간 뭐랄까요, 좀 어렵습니다."), ["H:어", "B:약간", "B:뭐랄까", "B:좀"]);
  assert.deepEqual(words("음음 그건 아무튼 됩니다"), ["H:음", "B:아무튼"]);
});

test("findFillers: 그/저 count only when hesitated", () => {
  assert.deepEqual(words("그 제품은 저희가 만들었습니다."), []); // determiner / pronoun → not fillers
  assert.deepEqual(words("그, 제품은 좋습니다."), ["H:그"]); // followed by comma
  assert.deepEqual(words("저 저희는 리웨이브입니다."), ["H:저"]); // restart "저 저희는"
  assert.deepEqual(words("그 그러니까요"), ["H:그", "B:그러니까"]);
  assert.equal(countFillers("사실상 불가능합니다"), 0); // 사실상 ≠ 사실
});

test("rate, time usage and sentence length from timestamps", () => {
  // 4 sentences × 20 syllables starting at 0, 4, 8, 12 s → articulation 5 syll/s, last ends at 12 + 4 = 16 s
  const x = "가나다라마바사아자차".repeat(2);
  const t = [S(0, x), S(4, x), S(8, x), S(12, x)];
  const m = computeSpeechMetrics(t, { presentationMinutes: 1 });
  assert.equal(m.sentenceCount, 4);
  assert.equal(m.syllables, 80);
  assert.equal(m.articulationSps, 5);
  assert.equal(m.spokenSeconds, 16);
  assert.equal(m.syllablesPerMinute, 300);
  assert.equal(m.sentencesPerMinute, 15);
  assert.equal(m.rateStatus, "ok");
  assert.equal(m.timeStatus, "short"); // 16 s of a 60 s slot
  assert.equal(m.avgSentenceSyllables, 20);
  assert.equal(m.pauses.count, 0);
});

test("long pauses, fast rate and penalties", () => {
  const long = "가".repeat(40);
  // 40 syllables every 5 s → 8 syll/s = 480 syll/min (fast); one 15 s gap → 10 s pause, excluded from the rate
  const t = [S(0, long), S(5, long), S(10, long), S(25, long), S(30, long)];
  const m = computeSpeechMetrics(t, { presentationMinutes: 0.5 });
  assert.equal(m.articulationSps, 8);
  assert.equal(m.pauses.count, 1);
  assert.equal(m.pauses.longest, 10);
  assert.equal(m.syllablesPerMinute, 480);
  assert.equal(m.pauses.items[0].afterIndex, 2);
  assert.equal(m.rateStatus, "fast");
  assert.equal(m.timeStatus, "over");
  assert.ok(m.deliveryPenalties.some((p) => p.reason.startsWith("말 속도 빠름")));
  assert.ok(m.deliveryPenalties.some((p) => p.reason.startsWith("시간 초과")));
  assert.ok(m.deliveryScore < 80);
});

test("only the presentation phase is analysed; empty transcript is safe", () => {
  const t = [S(0, "음, 발표입니다."), S(3, "어, 질의응답 답변입니다.", "qa")];
  assert.equal(computeSpeechMetrics(t).sentenceCount, 1);
  assert.equal(computeSpeechMetrics(t, { phase: "all" }).sentenceCount, 2);
  const e = computeSpeechMetrics([], { presentationMinutes: 5 });
  assert.equal(e.sentenceCount, 0);
  assert.equal(e.deliveryScore, 0);
  assert.equal(e.syllablesPerMinute, 0);
});

test("Q&A-only transcript is NOT scored as the presentation (review fix)", () => {
  const m = computeSpeechMetrics([S(0, "음 답변입니다", "qa"), S(4, "어 그러니까 그렇습니다", "qa")], { presentationMinutes: 5 });
  assert.equal(m.sentenceCount, 0);
  assert.equal(m.fillers.total, 0);
  assert.equal(m.deliveryScore, 0);
  assert.deepEqual(m.deliveryPenalties, []);
});

test("fixture sessions: clean sample vs filler-heavy BAD vs GOOD", () => {
  const load = (f) => JSON.parse(readFileSync(f, "utf8"));
  const run = (s) => computeSpeechMetrics(s.transcript, { presentationMinutes: s.presentationMinutes });
  const sample = run(load("fixtures/sample-session.json"));
  assert.equal(sample.sentenceCount, 46);
  assert.equal(sample.fillers.total, 6); // 음×2, 그러니까×2, 어, 이제
  assert.equal(sample.rateStatus, "ok");
  const bad = run(load("report/samples/session-bad.json"));
  const good = run(load("report/samples/session-good.json"));
  assert.ok(bad.fillers.perMinute > 10, `bad fillers/min ${bad.fillers.perMinute}`);
  assert.equal(bad.timeStatus, "short");
  assert.ok(bad.pauses.count >= 3);
  assert.equal(good.fillers.total, 0);
  assert.equal(good.timeStatus, "ok");
  assert.ok(good.deliveryScore - bad.deliveryScore >= 40, `good ${good.deliveryScore} vs bad ${bad.deliveryScore}`);
});
