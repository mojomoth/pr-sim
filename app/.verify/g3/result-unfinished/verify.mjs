// /result for unfinished sessions (setup/presentation/qa) must not request /api/report; storage error ≠ missing.
import { readFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { buildSession, seed, readSession, savedReportPath } from "../../g2/SCREENS-C/seed.mjs";
const dir = new URL(".", import.meta.url).pathname;
const rec = JSON.parse(readFileSync(savedReportPath, "utf8"));
const { browser, page } = await launch({ mobile: true });
const out = [];
const apiCalls = [];
await page.setRequestInterception(true);
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname === "/api/report" || u.pathname === "/api/wiki") { apiCalls.push(`${r.method()} ${u.pathname}`); return r.abort(); }
  r.continue();
});
const text = () => page.evaluate(() => document.body.innerText);
try {
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  const cases = [
    ["setup", { ...buildSession("s_u_setup"), status: "setup", transcript: [], qa: [] }, "/setup?s=s_u_setup"],
    ["presentation", { ...buildSession("s_u_pres"), status: "presentation", qa: [], resume: { phase: "presentation", remainingSec: 120 } }, "/present?s=s_u_pres"],
    ["qa", { ...buildSession("s_u_qa"), status: "qa", resume: { phase: "qa", remainingSec: 60 } }, "/qa?s=s_u_qa"],
  ];
  for (const [name, s, want] of cases) {
    apiCalls.length = 0;
    await seed(page, s);
    await page.goto(`http://localhost:3000/result?s=${s.id}`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.innerText.includes("아직 끝나지 않은 연습이에요"), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));
    const href = await page.$$eval("a", (as) => as.find((a) => a.textContent.includes("이어하기"))?.getAttribute("href"));
    const after = await readSession(page, s.id);
    await shot(page, `${dir}${name}-unfinished.png`);
    out.push([name, `href=${href} want=${want} ${href === want ? "OK" : "FAIL"} apiCalls=${JSON.stringify(apiCalls)} status=${after.status} report=${!!after.report}`]);
  }
  // regression: finished session with saved report renders summary, no API call
  apiCalls.length = 0;
  await seed(page, rec);
  await page.goto(`http://localhost:3000/result?s=${rec.id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-testid=total-score]", { timeout: 10000 });
  await shot(page, `${dir}done-summary.png`);
  out.push(["done+report", `summary OK apiCalls=${JSON.stringify(apiCalls)}`]);
  // regression: status "report" without report still starts generation (request intercepted+aborted, no real API spend)
  apiCalls.length = 0;
  await seed(page, buildSession("s_u_report"));
  await page.goto("http://localhost:3000/result?s=s_u_report", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("결과를 만들지 못했어요"), { timeout: 15000 });
  out.push(["status=report", `generation requested apiCalls=${JSON.stringify(apiCalls)}`]);
  // missing
  await page.goto("http://localhost:3000/result?s=s_nope", { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("기록을 찾을 수 없어요"), { timeout: 10000 });
  await shot(page, `${dir}missing.png`);
  out.push(["missing", "OK"]);
  // storage error: IndexedDB open fails → "불러오지 못했어요" + 다시 시도 (not "찾을 수 없어요")
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p2.evaluateOnNewDocument(() => {
    window.__failIdb = true;
    const orig = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...a) => {
      if (!window.__failIdb) return orig(...a);
      const req = {};
      setTimeout(() => req.onerror && req.onerror(new Event("error")), 0);
      return req;
    };
  });
  await p2.goto("http://localhost:3000/result?s=s_u_qa", { waitUntil: "networkidle2" });
  await p2.waitForFunction(() => document.body.innerText.includes("기록을 불러오지 못했어요"), { timeout: 10000 });
  await shot(p2, `${dir}storage-error.png`);
  const errText = await p2.evaluate(() => document.body.innerText);
  out.push(["storage error", `${errText.includes("찾을 수 없어요") ? "FAIL shows missing" : "OK"} retryBtn=${errText.includes("다시 시도")}`]);
  // retry after storage recovers
  await p2.evaluate(() => { window.__failIdb = false; });
  await p2.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("다시 시도")).click());
  await p2.waitForFunction(() => document.body.innerText.includes("아직 끝나지 않은 연습이에요"), { timeout: 10000 });
  await shot(p2, `${dir}storage-retry-ok.png`);
  out.push(["storage retry", "OK → unfinished notice"]);
} catch (e) {
  out.push(["ERROR", String(e)]);
  await shot(page, `${dir}99-error.png`).catch(() => {});
} finally {
  console.log(out.map((x) => x.join(": ")).join("\n"));
  await browser.close();
}
