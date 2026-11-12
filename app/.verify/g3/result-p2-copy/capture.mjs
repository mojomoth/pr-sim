// G3 SCREENS-C P2 fixes: feedback nav centring, <details> summary, chip hit areas, model label, copy.
//   node capture.mjs   (mobile 390×844 + desktop 1440×900)
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { seed } from "../../g2/SCREENS-C/seed.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/result-p2-copy";
const BASE = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-C/session-with-report.json", "utf8"));
const lite = {
  ...report,
  id: "s_g3lite",
  report: { ...report.report, meta: { ...report.report.meta, provider: "gemini:gemini-3.8-flash-lite ×7, openai:gpt-6-astra ×2 (OpenAI 크레딧 소진 → 폴백)", usage: { ...report.report.meta.usage, byModel: { "gemini:gemini-3.8-flash-lite": 7, "openai:gpt-6-astra": 2 } } } },
};
const out = {};
const clickText = (page, text) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll("button, a, summary")].find((x) => x.textContent.replace(/\s+/g, " ").trim().includes(text) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text);
const text = (page) => page.evaluate(() => document.body.innerText);
async function full(page, file) {
  const vp = page.viewport();
  const h = await page.evaluate(() => document.getElementById("app-scroll")?.scrollHeight ?? 844);
  if (h > vp.height) await page.setViewport({ ...vp, height: Math.min(h + 2, 6000) });
  await sleep(500);
  await shot(page, `${OUT}/${file}`);
  await page.setViewport(vp);
  await sleep(300);
}

for (const dev of ["mobile", "desktop"]) {
  const mobile = dev === "mobile";
  const { browser, page, logs } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1440, height: 900 });
  const r = (out[dev] = {});
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await seed(page, report);
    await seed(page, lite);

    // 05 results
    await page.goto(`${BASE}/result?s=${report.id}`, { waitUntil: "networkidle2" });
    await page.waitForSelector("[data-testid=total-score]", { timeout: 20000 });
    await sleep(1000);
    r.summaryModelLine = (await text(page)).split("\n").find((l) => l.includes("평가 모델"));
    if (mobile) await full(page, "05-results-mobile-full.png");
    else await shot(page, `${OUT}/05-results-desktop.png`);

    // 06 feedback, Q1
    await page.goto(`${BASE}/result?s=${report.id}&tab=feedback`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.innerText.includes("질문별 피드백"), { timeout: 20000 });
    await sleep(1500);
    r.feedbackModelLine = (await text(page)).split("\n").find((l) => l.includes("평가 모델"));
    r.nav = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="질문 이동"]');
      const nr = nav.getBoundingClientRect();
      const btn = [...nav.querySelectorAll("button")].map((b) => { const x = b.getBoundingClientRect(); return { text: b.textContent.trim(), visible: getComputedStyle(b).visibility, left: Math.round(x.left), right: Math.round(x.right), h: Math.round(x.height) }; });
      return { navCenter: Math.round((nr.left + nr.right) / 2), next: btn[1], nextCenter: Math.round((btn[1].left + btn[1].right) / 2), prev: btn[0] };
    });
    r.summary = await page.evaluate(() => {
      const s = document.querySelector("details > summary");
      const x = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      const marker = getComputedStyle(s, "::marker").content;
      return { h: Math.round(x.height), w: Math.round(x.width), display: cs.display, listStyle: cs.listStyleType, marker, hasChevron: !!s.querySelector("svg") };
    });
    // chip hit areas: elementFromPoint 5px above / below the visible pill must still hit the chip
    r.chips = await page.evaluate(() => {
      const chips = [...document.querySelectorAll("button")].filter((b) => /쪽 보기|원문 보기|발화 보기/.test(b.getAttribute("aria-label") ?? "") && b.className.includes("before:"));
      return chips.map((b) => {
        b.scrollIntoView({ block: "center" });
        const x = b.getBoundingClientRect();
        const cx = (x.left + x.right) / 2;
        const hit = (y) => { const e = document.elementFromPoint(cx, y); return !!e && (e === b || b.contains(e)); };
        return { label: b.getAttribute("aria-label"), visibleH: Math.round(x.height), hitAbove5: hit(x.top - 5), hitBelow5: hit(x.bottom - 0.5 + 5), hitAbove7: hit(x.top - 7) };
      });
    });
    await page.evaluate(() => document.getElementById("app-scroll")?.scrollTo({ top: 0 }));
    if (mobile) await full(page, "06-feedback-q1-mobile-full.png");
    else await shot(page, `${OUT}/06-feedback-q1-desktop.png`);

    // expanded details
    await clickText(page, "항목별 점수와 평가 근거");
    await sleep(500);
    r.detailsOpen = await page.evaluate(() => document.querySelector("details").open);
    await page.evaluate(() => document.querySelector("details").scrollIntoView({ block: "start" }));
    await sleep(300);
    await shot(page, `${OUT}/06-feedback-details-open-${dev}.png`);

    // Q2 → prev visible, next still centred
    await clickText(page, "다음 질문 보기");
    await sleep(800);
    r.navQ2 = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="질문 이동"]');
      nav.scrollIntoView({ block: "center" });
      const nr = nav.getBoundingClientRect();
      const [p, n] = [...nav.querySelectorAll("button")].map((b) => { const x = b.getBoundingClientRect(); return { text: b.textContent.trim(), visible: getComputedStyle(b).visibility, left: Math.round(x.left), right: Math.round(x.right) }; });
      return { navCenter: Math.round((nr.left + nr.right) / 2), prev: p, next: n, nextCenter: Math.round((n.left + n.right) / 2) };
    });
    await sleep(300);
    await shot(page, `${OUT}/06-feedback-q2-nav-${dev}.png`);
    r.missingLabel = (await text(page)).includes("답변에 넣었으면 좋았을 내용");

    // transcript sheet title
    await page.evaluate(() => document.getElementById("app-scroll")?.scrollTo({ top: 0 }));
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").includes("답변 원문 보기"))?.click());
    await sleep(800);
    r.transcriptTitle = await page.evaluate(() => document.querySelector('[role="dialog"] h2, [role="dialog"] [id]')?.textContent);
    r.transcriptDialogText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.split("\n")[0]);
    await shot(page, `${OUT}/06-transcript-sheet-${dev}.png`);
    await page.keyboard.press("Escape");
    await sleep(400);

    // analysis tab
    await clickText(page, "발표 분석");
    await sleep(1000);
    const t = await text(page);
    r.analysis = { 발표력분석: t.includes("발표력 분석"), 전달지표점수: t.includes("전달 지표 점수"), 잘한점: t.includes("잘한 점"), 아쉬운점: t.includes("아쉬운 점"), 다음연습에서는: t.includes("다음 연습에서는"), old: ["내용 및 전달력 분석", "강점\n", "부족한 점", "개선 제안", "전사"].filter((x) => t.includes(x)) };
    if (mobile) await full(page, "06-feedback-analysis-mobile-full.png");
    else await shot(page, `${OUT}/06-feedback-analysis-desktop.png`);

    // lite fallback notice + model label
    await page.goto(`${BASE}/result?s=${lite.id}`, { waitUntil: "networkidle2" });
    await page.waitForSelector("[data-testid=total-score]", { timeout: 20000 });
    await sleep(800);
    const lt = (await text(page)).split("\n");
    r.lite = { notice: lt.find((l) => l.includes("대체 모델")), model: lt.find((l) => l.includes("평가 모델")) };
    if (mobile) await full(page, "05-results-lite-mobile-full.png");

    // unknown session → primary button label
    await page.goto(`${BASE}/result?s=s_nope_g3`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.innerText.includes("기록을 찾을 수 없어요"), { timeout: 20000 });
    await sleep(500);
    r.missingButton = await page.evaluate(() => [...document.querySelectorAll("a")].map((a) => a.textContent.trim()).filter((x) => x.includes("기록")));
    await shot(page, `${OUT}/40-unknown-${dev}.png`);
  } catch (e) {
    r.error = String(e);
    console.error(e);
    await shot(page, `${OUT}/99-error-${dev}.png`).catch(() => {});
  } finally {
    r.consoleErrors = logs.filter((l) => /error/i.test(l)).slice(0, 10);
    await browser.close();
  }
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
