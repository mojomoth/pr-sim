import { test } from "node:test";
import { checkableFigures, regroundCitations } from "@/server/wiki/reground";
test("probe", () => {
  console.log("figs:", JSON.stringify(checkableFigures("국내 생산 리드타임 5일을 제공한다")));
  const raw = ["국내 생산으로 리드타임이 짧다.", "2025년 3월 25일 첫 출고를 기록했다."];
  console.log("A", JSON.stringify(regroundCitations("- 국내 생산 리드타임 5일을 제공한다. (p.1)", raw)));
  const raw2 = ["2026년 매출 목표 15억 원", "기타", "2026년 매출 목표 5일"];
  console.log("B", JSON.stringify(regroundCitations("- 계약 후 1일 안에 납품한다. (p.2)", ["계약 후 바로 납품. 11일 공휴일", "기타"])));
});
