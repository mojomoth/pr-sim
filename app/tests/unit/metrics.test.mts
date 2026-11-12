import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSpeechMetrics, countFillers } from "@/server/report/metrics";
import type { TranscriptSentence } from "@/server/types";

const s = (id: string, t: number, text: string, phase: TranscriptSentence["phase"] = "presentation"): TranscriptSentence => ({ id, t, text, phase });

test("empty transcript scores 0 without throwing", () => {
  const m = computeSpeechMetrics([]);
  assert.equal(m.sentenceCount, 0);
  assert.equal(m.deliveryScore, 0);
  assert.deepEqual(m.rateTimeline, []);
});

test("a bogus timestamp cannot allocate a huge timeline (capped at 360 minutes)", () => {
  const m = computeSpeechMetrics([s("a", 0, "시작합니다."), s("b", 10_000_000, "끝입니다.")]);
  assert.equal(m.rateTimeline.length, 360);
});

test("timeline buckets by minute from the first sentence", () => {
  const m = computeSpeechMetrics([s("a", 0, "가나다라마바사아자차."), s("b", 125, "가나다라마.")]);
  assert.deepEqual(m.rateTimeline, [
    { minute: 1, syllables: 10 },
    { minute: 2, syllables: 0 },
    { minute: 3, syllables: 5 },
  ]);
});

test("Q&A sentences are never scored as the presentation", () => {
  const m = computeSpeechMetrics([s("a", 0, "답변입니다.", "qa")]);
  assert.equal(m.sentenceCount, 0);
});

test("score stays within 0..100 and long pauses are counted", () => {
  const t = [s("a", 0, "음 그러니까 이제 저희 서비스는요."), s("b", 30, "어 그 진짜 좋습니다.")];
  const m = computeSpeechMetrics(t, { presentationMinutes: 10 });
  assert.ok(m.deliveryScore >= 0 && m.deliveryScore <= 100);
  assert.equal(m.pauses.count, 1);
  assert.equal(m.pauses.items[0].afterSentenceId, "a");
  assert.equal(m.timeStatus, "short");
  assert.ok(m.fillers.total >= 4);
});

test("countFillers counts hesitations and habit words only", () => {
  assert.equal(countFillers("음 그러니까 매출이 늘었습니다"), 2);
  assert.equal(countFillers("그 회사는 성장했습니다"), 0);
});
