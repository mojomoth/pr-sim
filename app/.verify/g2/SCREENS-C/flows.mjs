// 같은 조건으로 다시 연습, back from 06, not-ready session, report error + retry UI.
import { readFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { buildSession, seed, savedReportPath } from "./seed.mjs";
const dir = new URL(".", import.meta.url).pathname;
const rec = JSON.parse(readFileSync(savedReportPath, "utf8"));
const { browser, page, logs } = await launch({ mobile: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const all = () => page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onsuccess = () => res(r.result); });
  const list = await new Promise((res) => { const g = db.transaction("sessions").objectStore("sessions").getAll(); g.onsuccess = () => res(g.result); });
  const keys = await new Promise((res) => { const g = db.transaction("blobs").objectStore("blobs").getAllKeys(); g.onsuccess = () => res(g.result); });
  db.close();
  return { sessions: list.map((s) => ({ id: s.id, status: s.status, judges: s.judges.map((j) => j.thumbKey), docs: Object.values(s.docs).map((d) => d.wikiState), report: !!s.report })), keys };
});
try {
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await seed(page, rec);
  await page.goto(`http://localhost:3000/result?s=${rec.id}&tab=feedback`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("질문별 피드백"));
  // back chevron → 05
  await page.click('header a[aria-label="뒤로 가기"]');
  await page.waitForSelector("[data-testid=total-score]", { timeout: 10000 });
  out.push(["back from 06", page.url()]);
  await page.goto(`http://localhost:3000/result?s=${rec.id}&tab=feedback`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("같은 조건으로 다시 연습"));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("같은 조건으로 다시 연습")).click());
  await page.waitForFunction(() => location.pathname !== "/result", { timeout: 15000 });
  out.push(["again →", page.url()]);
  out.push(["db", JSON.stringify(await all())]);
  // not-ready session (no transcript/qa)
  const empty = { ...buildSession("s_empty"), transcript: [], qa: [] };
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await seed(page, empty);
  await page.goto("http://localhost:3000/result?s=s_empty", { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("아직 결과를 만들 수 없어요"), { timeout: 10000 });
  await shot(page, `${dir}41-not-ready.png`);
  out.push(["not ready", "ok"]);
  // report error: pages over the 120-page limit → 413 too_large (terminal, not retryable)
  const bad = buildSession("s_bad");
  bad.docs.presentation = { ...bad.docs.presentation, wiki: [], pageTexts: Array.from({ length: 130 }, () => "가") };
  bad.docs.proposal = { ...bad.docs.proposal, wiki: [] };
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await seed(page, bad);
  await page.goto("http://localhost:3000/result?s=s_bad", { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("결과를 만들지 못했어요"), { timeout: 30000 });
  await shot(page, `${dir}42-report-error.png`);
  out.push(["error", await page.$eval("[role=alert]", (e) => e.innerText)]);
  out.push(["bad saved report?", JSON.stringify((await all()).sessions.find((s) => s.id === "s_bad"))]);
} catch (e) {
  out.push(["ERROR", String(e)]);
  await shot(page, `${dir}99-flows-error.png`).catch(() => {});
} finally {
  console.log(out.map((x) => x.join(": ")).join("\n"));
  await browser.close();
}
