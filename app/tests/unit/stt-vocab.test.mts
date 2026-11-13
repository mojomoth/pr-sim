import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_VOCAB, sessionVocabulary } from "@/features/stt/vocab";
import { SttTokenIn } from "@/server/stt/token";

const doc = (over: object) => ({ role: "presentation", pageTexts: [], ...over }) as never;
const kn = (metric: string) => ({ metric, value: "1", pages: [1], note: "", conflict: false });
const page = (title: string, type = "topic") => ({ slug: title, title, type, summary: "", sources: [], markdown: "" });

test("sessionVocabulary: domain words from metrics and wiki titles, compound words first, used words only", () => {
  const v = sessionVocabulary([
    doc({
      pageTexts: ["바다에서 온 완충재 웨이브셀. 완충재 폐기물은 연간 31만 톤. 고객 고객 고객 고객 재구매율 83%. 버섯균사체 단가 310원. 3PL 고객."],
      keyNumbers: [kn("완충재 폐기물"), kn("고객 재구매율"), kn("경쟁 대안 수입 버섯균사체 단가"), kn("2025년 매출"), kn("3PL 파일럿 고객 수")],
      wiki: [page("웨이브셀"), page("색인", "meta")],
    }),
    undefined,
  ]);
  assert.equal(v[0], "완충재"); // 3+ chars and used most
  for (const w of ["웨이브셀", "버섯균사체", "재구매율", "3PL", "폐기물", "고객"]) assert.ok(v.includes(w), w);
  // not in the pages, too short, years/numbers, meta page titles
  for (const w of ["경쟁", "대안", "수입", "매출", "2025년", "수", "색인", "파일럿"]) assert.ok(!v.includes(w), w);
  assert.ok(v.indexOf("고객") > v.indexOf("3PL")); // plain two-syllable nouns go last
});

test("sessionVocabulary caps the list and is empty without a wiki", () => {
  const metrics = Array.from({ length: 80 }, (_, i) => kn(`용어${i}번`));
  const text = metrics.map((m) => m.metric).join(" ");
  assert.equal(sessionVocabulary([doc({ pageTexts: [text], keyNumbers: metrics })]).length, MAX_VOCAB);
  assert.deepEqual(sessionVocabulary([doc({ pageTexts: ["완충재"] })]), []);
});

test("SttTokenIn: vocabulary optional, capped in count and length", () => {
  assert.ok(SttTokenIn.safeParse({}).success);
  assert.deepEqual(SttTokenIn.parse({ vocabulary: [" 완충재 "] }), { vocabulary: ["완충재"] });
  assert.equal(SttTokenIn.safeParse({ vocabulary: Array(61).fill("가나") }).success, false);
  assert.equal(SttTokenIn.safeParse({ vocabulary: ["가".repeat(41)] }).success, false);
  assert.equal(SttTokenIn.safeParse({ vocabulary: [""] }).success, false);
});
