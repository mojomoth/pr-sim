import assert from "node:assert/strict";
import { test } from "node:test";
import { checkableFigures, regroundCitations } from "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-4/review/reground-head.ts";

// Excerpts of the real raw pages (proposal p.1–10, G1 cite audit: 5/173 misses). p.5's last sentence runs over
// the page break into p.6, and the extractor cited p.6 (or another neighbour) for its dates/day spans.
const raw = [
  "주식회사 리웨이브 사업계획서",
  "",
  "",
  "누적 출고는 2025년 3월 첫 출고 이후 158만\n세트를 기록하였다. 세트당\n165원이라는 가격대에서 국내 생산 리드타임 5일을 제공하여",
  "영업이익은 2025년 -7억 원, 2026E -11억 원, 2027E -9억 원, 2028E\n+6억 원, 2029E +31억 원으로, 2028년 흑자 전환을 목표로 한다.\n국내 생산 리드타임 5일이라는 요소를 결합해 단가 외 가치로",
  "설득하고 있다. 특히 D2C 브랜드와 신선식품 몰은 소비자 접점에서 친환경 포장재의 메시지 효과가 크므로",
  "2025년 3월 웨이브셀 첫 출고 실제 고객 납품을 통한 상용화 시작",
  "연구 조직은 내수 코팅 v2와 웨이브팩 개발을 병행하고 있으며",
  "세트당 원가 142원",
  "판매가 165원",
];

test("checkableFigures includes dates and day spans, still skips bare one-digit counts", () => {
  assert.deepEqual(checkableFigures("2025년 3월 첫 출고, 리드타임 5일"), ["2025년3월", "5일"]);
  assert.deepEqual(checkableFigures("2028년 흑자 전환"), ["2028년"]);
  assert.deepEqual(checkableFigures("내수 코팅 v2 개발, 3개 공장"), []);
});

test("reground adds the page that states a date/day span cited across a page break (real G1 misses)", () => {
  const body = [
    "- 리웨이브는 규제 대응, 브랜드 친환경 이미지, 폐기 부담 감소, 국내 생산 리드타임 5일을 결합해 단가 외 가치로 설득하고 있다. (p.6)",
    "- 리웨이브는 2028년 흑자 전환을 목표로 한다. (p.4)",
    "- 2025년 3월 웨이브셀 첫 출고를 시작했다. (p.8)",
  ].join("\n");
  const { body: out, stats } = regroundCitations(body, raw);
  assert.deepEqual(
    out.split("\n").map((l) => l.match(/\(p\.[^)]*\)$/)?.[0]),
    ["(p.5, p.6)", "(p.4, p.5)", "(p.7, p.8)"], // nearest page that states it is added, the original kept
  );
  assert.deepEqual(stats, { groups: 3, fixed: 3, added: 3 });
});

test("reground leaves correct citations and derived values alone", () => {
  const body = [
    "- 누적 출고는 2025년 3월 첫 출고 이후 158만 세트이다. (p.4)",
    "- 세트당 원가 142원, 판매가 165원으로 차이는 23원이다. (p.9, p.10)", // 23원 is computed, on no page
    "- 리웨이브의 대응책은 내수 코팅 v2 개발이다. (p.8)",
  ].join("\n");
  const r = regroundCitations(body, raw);
  assert.equal(r.body, body);
  assert.equal(r.stats.fixed, 0);
});
