import assert from "node:assert/strict";
import { test } from "node:test";
import { regroundCitations } from "@/server/wiki/reground";
test("probe: 5일 on cited page wording differs, another page has 15일", () => {
  const raw = ["정산 주기는 매월 15일이다.", "국내 생산으로 리드타임을 닷새로 줄였다."];
  const r = regroundCitations("- 리드타임은 5일이다. (p.2)", raw);
  console.log(JSON.stringify(r));
});
