// G3 API copy fixes, browser part: result-generation progress labels (live /api/report) + feedback doc labels.
//   node browser.mjs   (mobile 390×844 + desktop 1440×900)
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { buildSession, seed } from "../../g2/SCREENS-C/seed.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/api-copy";
const BASE = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wikiOf = (role) => readFileSync(`/Users/jyl/work/study/pr-sim/app/.verify/g2/api/wiki-${role}.ndjson`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.type === "done");
const out = {};
const devs = process.argv[2] ? [process.argv[2]] : ["mobile", "desktop"];
for (const dev of devs) {
  const mobile = dev === "mobile";
  const { browser, page, logs } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1440, height: 900 });
  const r = (out[dev] = {});
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    const s = buildSession(`s_g3apicopy2_${dev}`);
    for (const role of ["presentation", "proposal"]) {
      const w = wikiOf(role);
      Object.assign(s.docs[role], { wiki: w.wiki, keyNumbers: w.keyNumbers, wikiBuiltAt: new Date().toISOString() });
    }
    await seed(page, s);
    const t0 = Date.now();
    await page.goto(`${BASE}/result?s=${s.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("두 자료의 수치 비교"), { timeout: 30000 });
    await sleep(4000);
    r.progress = (await page.evaluate(() => document.body.innerText)).split("\n").filter(Boolean);
    await shot(page, `${OUT}/05-progress-${dev}.png`);
    await sleep(14000);
    r.progressLater = (await page.evaluate(() => document.body.innerText)).split("\n").filter(Boolean);
    await shot(page, `${OUT}/05-progress-later-${dev}.png`);
    await page.waitForFunction(() => !!document.querySelector("[data-testid=total-score]") || /만들지 못했어요/.test(document.body.innerText), { timeout: 290000 });
    r.ms = Date.now() - t0;
    await sleep(1200);
    const t = await page.evaluate(() => document.body.innerText);
    r.outcome = t.includes("만들지 못했어요") ? t.split("\n").filter((l) => /못했어요|AI 평가|다시 시도/.test(l)) : "report done";
    await shot(page, `${OUT}/05-after-${dev}.png`);
    if (r.outcome === "report done") {
      await page.goto(`${BASE}/result?s=${s.id}&tab=feedback`, { waitUntil: "networkidle2" });
      await page.waitForFunction(() => document.body.innerText.includes("질문별 피드백"), { timeout: 20000 });
      await sleep(1500);
      await shot(page, `${OUT}/06-feedback-${dev}.png`);
      await page.evaluate(() => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === "자료 평가")?.click());
      await sleep(1200);
      const ft = await page.evaluate(() => document.body.innerText);
      r.materialsHeadings = ft.split("\n").filter((l) => /자료 평가|수치 비교/.test(l)).slice(0, 6);
      r.chipLabels = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "").filter((x) => /쪽 보기/.test(x)).slice(0, 6));
      await shot(page, `${OUT}/06-materials-${dev}.png`);
      await page.evaluate(() => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === "발표 분석")?.click());
      await sleep(1000);
      r.analysisPenalties = (await page.evaluate(() => document.body.innerText)).split("\n").filter((l) => /음절|군말|침묵|시간/.test(l)).slice(0, 8);
    }
  } catch (e) {
    r.error = String(e);
    await shot(page, `${OUT}/99-error-${dev}.png`).catch(() => {});
  } finally {
    r.consoleErrors = logs.filter((l) => /error/i.test(l)).slice(0, 10);
    await browser.close();
  }
}
writeFileSync(`${OUT}/browser-${devs.join("-")}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
