// Seed the saved session (with report) and screenshot 05 / 06 / citation sheets / unknown id. Usage: node views.mjs [desktop]
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { seed, savedReportPath } from "./seed.mjs";
const desktop = process.argv[2] === "desktop";
const dir = new URL(".", import.meta.url).pathname + (desktop ? "desktop-" : "");
const rec = JSON.parse(readFileSync(savedReportPath, "utf8"));
const { browser, page, logs } = await launch({ mobile: !desktop });
const tall = async (name) => {
  const vp = page.viewport();
  const h = await page.evaluate(() => document.getElementById("app-scroll").scrollHeight);
  if (!desktop) await page.setViewport({ ...vp, height: Math.min(h + 20, 9000) });
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, `${dir}${name}`);
  await page.setViewport(vp);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (sel, text) => page.evaluate((sel, text) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(text)); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; }, sel, text);
const checks = [];
try {
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await seed(page, rec);
  await page.goto(`http://localhost:3000/result?s=${rec.id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-testid=total-score]", { timeout: 20000 });
  await wait(800);
  await shot(page, `${dir}10-summary.png`);
  if (!desktop) await tall("11-summary-full.png");
  checks.push(["summary total", await page.$eval("[data-testid=total-score]", (e) => e.textContent)]);
  // 상세 피드백 보기
  await clickText("a", "상세 피드백 보기");
  await page.waitForFunction(() => location.search.includes("tab=feedback") && document.body.innerText.includes("질문별 피드백"), { timeout: 15000 });
  await wait(1200);
  await shot(page, `${dir}20-feedback-qa.png`);
  if (!desktop) await tall("21-feedback-qa-full.png");
  checks.push(["judge img", await page.$$eval("article img", (a) => a.map((i) => i.src.slice(0, 5) + " " + i.naturalWidth))]);
  // doc citation → slide sheet
  if (await clickText("[role=tabpanel] button", "제안자료") || await clickText("[role=tabpanel] button", "발표자료")) {
    await page.waitForSelector("[role=dialog] canvas", { timeout: 20000 }).catch(() => {});
    await wait(1500);
    checks.push(["sheet", await page.$eval("[role=dialog]", (d) => d.innerText.slice(0, 120))]);
    await shot(page, `${dir}22-page-sheet.png`);
    await page.keyboard.press("Escape");
    await wait(400);
  } else checks.push(["sheet", "no doc chip on q1"]);
  // answer transcript ref
  if (await clickText("[role=tabpanel] button", "원문 ")) {
    await wait(800);
    checks.push(["transcript", await page.$eval("[role=dialog] [aria-current=true]", (d) => d.innerText).catch(() => "none")]);
    await shot(page, `${dir}23-transcript-sheet.png`);
    await page.keyboard.press("Escape");
    await wait(400);
  }
  // next question
  await clickText("nav button", "다음 질문 보기");
  await wait(600);
  await shot(page, `${dir}24-feedback-q2.png`);
  // analysis tab
  await clickText("[role=tab]", "발표 분석");
  await wait(800);
  await shot(page, `${dir}30-analysis.png`);
  if (!desktop) await tall("31-analysis-full.png");
  if (await clickText("[role=tabpanel] button", "발표 ")) {
    await wait(800);
    checks.push(["speech transcript", await page.$eval("[role=dialog] [aria-current=true]", (d) => d.innerText).catch(() => "none")]);
    await shot(page, `${dir}32-speech-sentence-sheet.png`);
    await page.keyboard.press("Escape");
    await wait(400);
  }
  if (await clickText("[role=tabpanel] button", "p.")) {
    await page.waitForSelector("[role=dialog] canvas", { timeout: 20000 }).catch(() => {});
    await wait(1500);
    checks.push(["coverage page", await page.$eval("[role=dialog] h2", (d) => d.innerText)]);
    await shot(page, `${dir}33-coverage-page-sheet.png`);
    await page.keyboard.press("Escape");
  }
  // unknown id
  await page.goto("http://localhost:3000/result?s=nope", { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("기록을 찾을 수 없어요"), { timeout: 15000 });
  await shot(page, `${dir}40-unknown.png`);
  checks.push(["unknown", "ok"]);
} catch (e) {
  checks.push(["ERROR", String(e)]);
  await shot(page, `${dir}99-error.png`).catch(() => {});
} finally {
  console.log(checks.map((c) => c.join(": ")).join("\n"));
  writeFileSync(`${dir}views-console.log`, logs.join("\n"));
  await browser.close();
}
