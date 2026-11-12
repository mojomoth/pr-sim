// Round-3 regression: "위키 다시 만들기" must never take a ready wiki down. No LLM, no dev server.
//   node wiki/tests/fix-r3-staging.mjs [sourceDocId]      (run from pocs/)
// Copies a ready doc from .data/wiki into a temp root under a fake docId and runs the REAL wiki lib there
// (wiki/tests/r3/hooks.mjs transpiles it; "@/lib/ai" is a fake client, see r3/mock-ai.mjs):
//   A failed rebuild    → old pages/keynumbers/lint intact, status ready + lastReingestError, query OK during and after
//   B successful rebuild → old wiki served during the build, then swapped in atomically, log history kept
//   C preflight         → no provider → LlmUnavailableError (Korean), nothing started
//   D saveAnswer        → refused while rebuilding / not ready; slug carries a hash of the full query
//   E query log         → context-only queries go to log-queries.md, not log.md
//   F deleteDoc         → refused while a job runs; removes the doc dir
import "./r3/hooks.mjs";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const POCS = process.cwd();
const SRC = process.argv[2] ?? "b074e9bd3e49c31f";
const SB = "00000000deadbeef";
const tmp = await mkdtemp(path.join(os.tmpdir(), "wiki-r3-"));
const dir = path.join(tmp, ".data", "wiki", SB);
await cp(path.join(POCS, ".data", "wiki", SRC), dir, { recursive: true });
for (const f of ["raw/meta.json", "state/status.json"]) {
  const p = path.join(dir, f);
  const j = JSON.parse(await readFile(p, "utf8"));
  Object.assign(j, { docId: SB, filename: "SANDBOX.pdf" });
  delete j.rebuild;
  delete j.lastReingestError;
  await writeFile(p, JSON.stringify(j, null, 1));
}
process.chdir(tmp); // store.ts resolves .data/wiki from cwd at import
process.env.WIKI_LLM_PROVIDER = "openai";
const lib = await import(path.join(POCS, "wiki/lib/index.ts"));
const { isRunning } = await import(path.join(POCS, "wiki/lib/ingest.ts")); // same module instance as lib's
const mock = globalThis.__mockAi;

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fingerprint() {
  const h = createHash("md5");
  for (const sub of ["wiki", "state"]) {
    for (const f of (await readdir(path.join(dir, sub))).sort()) {
      if (["status.json", "log.md", "log-queries.md"].includes(f)) continue;
      h.update(`${sub}/${f}\0`).update(await readFile(path.join(dir, sub, f)));
    }
  }
  return h.digest("hex");
}
const stagingLeft = async () => (await readdir(path.dirname(dir)).catch(() => [])).length + (await readdir(dir)).filter((d) => /\.(next|prev)$/.test(d)).length - 1;
const resetBreakers = () => {
  for (const k of Object.keys(globalThis.__wikiBreakers ?? {})) delete globalThis.__wikiBreakers[k];
};
/** Poll while the job runs: status + query + page read must keep working against the OLD wiki. */
async function during(oldOverview) {
  const seen = { polls: 0, rebuildSeen: false, notReady: 0, queryFail: 0, pageMismatch: 0, saveRefused: 0, phases: new Set() };
  while (isRunning(SB)) {
    seen.polls++;
    const st = await lib.getWikiStatus(SB);
    if (!st || st.state !== "ready") seen.notReady++;
    if (!st) continue;
    if (st.rebuild) {
      seen.rebuildSeen = true;
      seen.phases.add(st.rebuild.state);
    }
    try {
      const q = await lib.queryWiki(SB, `세트당 원가 ${seen.polls}`, { selector: "lexical" });
      if (!q.context) seen.queryFail++;
    } catch {
      seen.queryFail++;
    }
    if ((await lib.readWikiPage(SB, "overview")) !== oldOverview && (await lib.getWikiStatus(SB))?.rebuild) seen.pageMismatch++;
    if (seen.polls === 1) await lib.saveAnswer(SB, { query: "q", answer: "a" }).catch((e) => /다시 만드는 중/.test(e.message) && seen.saveRefused++);
    await sleep(40);
  }
  return seen;
}

try {
  const before = await fingerprint();
  const oldOverview = await lib.readWikiPage(SB, "overview");
  const oldPages = (await lib.listWikiPages(SB)).map((p) => p.slug);
  const oldLogEntries = (await readFile(path.join(dir, "wiki/log.md"), "utf8")).split("\n").filter((l) => l.startsWith("## [")).length;
  const hadLint = (await readdir(path.join(dir, "state"))).some((f) => f.startsWith("lint"));

  // ---- A: failed rebuild keeps the old wiki
  Object.assign(mock, { mode: "fail", delayMs: 800 });
  const r = await lib.reingest(SB, { preflight: false });
  ok(r.docId === SB && !r.reused, "A reingest started for the sandbox id (not the source hash)", JSON.stringify(r));
  const dA = await during(oldOverview);
  while (isRunning(SB)) await sleep(50);
  ok(dA.rebuildSeen && dA.notReady === 0, "A status stayed ready (rebuild progress nested) during the build", `polls=${dA.polls} phases=${[...dA.phases]}`);
  ok(dA.queryFail === 0 && dA.pageMismatch === 0, "A query + old pages served during the build", `queryFail=${dA.queryFail} pageMismatch=${dA.pageMismatch}`);
  ok(dA.saveRefused === 1, "D saveAnswer refused while rebuilding");
  const stA = await lib.getWikiStatus(SB);
  ok(stA.state === "ready" && !stA.rebuild && !!stA.lastReingestError, "A after failure: ready + lastReingestError", stA.lastReingestError);
  ok((await fingerprint()) === before, "A pages/keynumbers/lint/notes/plan byte-identical after failure");
  ok((await stagingLeft()) === 0, "A no staging dirs left");
  const qA = await lib.queryWiki(SB, "R3 고유 질의: 세트당 원가와 매출총이익률은?", { selector: "lexical" });
  ok(!!qA.context && qA.pages.length > 0, "A query after failure works", `${qA.contextChars}자`);
  ok(/다시 만들기 실패 — 기존 위키 유지/.test(await readFile(path.join(dir, "wiki/log.md"), "utf8")), "A failure recorded in live log.md");

  // ---- E: query log routing
  const logMd = await readFile(path.join(dir, "wiki/log.md"), "utf8");
  const lq = await readFile(path.join(dir, "wiki/log-queries.md"), "utf8").catch(() => "");
  ok(!logMd.includes("R3 고유 질의") && lq.includes("R3 고유 질의"), "E context-only query → log-queries.md only");

  // ---- B: successful rebuild swaps in
  Object.assign(mock, { mode: "ok", delayMs: 600, calls: [] });
  resetBreakers();
  await lib.reingest(SB, { preflight: false });
  const dB = await during(oldOverview);
  await lib.waitForWiki(SB);
  ok(dB.rebuildSeen && dB.notReady === 0 && dB.queryFail === 0 && dB.pageMismatch === 0, "B old wiki ready/queryable/readable during a successful build", `polls=${dB.polls} phases=${[...dB.phases]}`);
  const stB = await lib.getWikiStatus(SB);
  const newPages = (await lib.listWikiPages(SB)).map((p) => p.slug);
  ok(stB.state === "ready" && !stB.rebuild && !stB.lastReingestError, "B status ready, rebuild + lastReingestError cleared");
  ok(newPages.some((s) => s.startsWith("모의-주제")) && !newPages.some((s) => oldPages.includes(s) && !["overview", "주요-수치"].includes(s)), "B new wiki swapped in", `${oldPages.length}p → ${newPages.length}p`);
  const stateFiles = await readdir(path.join(dir, "state"));
  ok(!stateFiles.some((f) => f.startsWith("lint")) || !hadLint, "B stale lint reports dropped with the old wiki", stateFiles.join(","));
  const logB = await readFile(path.join(dir, "wiki/log.md"), "utf8");
  const entriesB = logB.split("\n").filter((l) => l.startsWith("## [")).length;
  ok(entriesB > oldLogEntries && /다시 만들기 실패/.test(logB) && /다시 만들기 시작\(스테이징\)/.test(logB), "B log.md keeps old history + new build entries", `${oldLogEntries} → ${entriesB}`);
  ok((await readFile(path.join(dir, "wiki/log-queries.md"), "utf8").catch(() => "")).includes("R3 고유 질의"), "B log-queries.md carried over");
  ok((await stagingLeft()) === 0, "B no staging/prev dirs left");

  // ---- D: saved-answer slugs
  const a1 = await lib.saveAnswer(SB, { query: "세트당 원가와 매출총이익률은 얼마이고 근거는?", answer: "142원 (p.3)" });
  const a2 = await lib.saveAnswer(SB, { query: "세트당 원가와 매출총이익률은 얼마이고 경쟁사 대비는?", answer: "비슷함 (p.4)" });
  const a1b = await lib.saveAnswer(SB, { query: "세트당 원가와 매출총이익률은 얼마이고 근거는?", answer: "142원 (p.3) 갱신" });
  ok(a1.savedAs !== a2.savedAs && a1.savedAs === a1b.savedAs && /-[0-9a-f]{6}$/.test(a1.savedAs), "D same first 5 words → different slugs; same query → same slug", `${a1.savedAs} / ${a2.savedAs}`);
  ok(/저장|file/.test(await readFile(path.join(dir, "wiki/log.md"), "utf8")), "D filing logged in log.md");

  // ---- C: preflight refuses when no provider is available
  Object.assign(mock, { mode: "unavailable", calls: [] });
  resetBreakers();
  const fpC = await fingerprint();
  const e = await lib.reingest(SB).then(() => null, (x) => x);
  ok(e?.name === "LlmUnavailableError" && /다시 만들 수 없습니다/.test(e.message) && /그대로 유지/.test(e.message), "C preflight → LlmUnavailableError (503) in Korean", e?.message);
  ok(!(await lib.getWikiStatus(SB)).rebuild && (await fingerprint()) === fpC, "C nothing started, wiki untouched");

  // ---- D2: not-ready status refuses saveAnswer
  const stP = path.join(dir, "state/status.json");
  const stRaw = await readFile(stP, "utf8");
  await writeFile(stP, JSON.stringify({ ...JSON.parse(stRaw), state: "error", error: "x" }));
  const e2 = await lib.saveAnswer(SB, { query: "q2", answer: "a2" }).then(() => null, (x) => x);
  ok(!!e2 && /준비되지 않았/.test(e2.message), "D saveAnswer refused when state is not ready", e2?.message);
  await writeFile(stP, stRaw);

  // ---- F: delete
  Object.assign(mock, { mode: "fail", delayMs: 400 });
  resetBreakers();
  await lib.reingest(SB, { preflight: false });
  const e3 = await lib.deleteDoc(SB).then(() => null, (x) => x);
  ok(!!e3 && /만드는 중이라 삭제할 수 없습니다/.test(e3.message), "F delete refused while a job runs");
  while (isRunning(SB)) await sleep(50);
  const del = await lib.deleteDoc(SB);
  ok(del.deleted && !(await lib.listDocs()).some((d) => d.docId === SB) && (await lib.getWikiStatus(SB)) === null, "F deleteDoc removes the doc");
} catch (e) {
  fail++;
  console.log("FAIL exception", e);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
