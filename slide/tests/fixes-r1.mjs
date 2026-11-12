// Fix round 1 verification (fix:slide) — run from pocs/: node slide/tests/fixes-r1.mjs
// Screenshots → .verify/slide/fix1/
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const OUT = ".verify/slide/fix1";
mkdirSync(OUT, { recursive: true });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const bad = (logs) => logs.filter((l) => /^\[(error|pageerror|requestfailed)\]|fake worker/i.test(l));
const panel = (page) =>
  page.evaluate(() => {
    const r = document.querySelector("[data-state]");
    const m = (k) => document.querySelector(`[data-metric="${k}"]`)?.textContent;
    return {
      page: Number(r?.dataset.page),
      indicator: document.querySelector("[data-page-indicator]")?.textContent,
      fileInfo: document.querySelector("[data-file-name]")?.nextElementSibling?.textContent,
      metricPage: m("page"), load: m("load"), ttfp: m("ttfp"), renders: Number(m("renders")),
      focus: document.activeElement?.hasAttribute("data-slide-viewer") ? "viewer" : document.activeElement?.tagName,
    };
  });
const waitPanel = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, { timeout }, arg).catch(() => {});

// ── 1. Mobile: re-tap active sample (twice) → restarts at 1 with fresh metrics ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-sample="presentation"]');
  await page.tap('[data-sample="presentation"]');
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  for (let i = 0; i < 5; i++) { await page.keyboard.press("ArrowRight"); await sleep(120); }
  await sleep(500);
  let s = await panel(page);
  check("M1 at page 6 before re-tap", s.page === 6, s.indicator);
  for (let round = 1; round <= 2; round++) {
    await page.tap('[data-sample="presentation"]');
    await waitPanel(page, () => /ms$/.test(document.querySelector('[data-metric="ttfp"]')?.textContent ?? ""));
    await sleep(300);
    s = await panel(page);
    check(`M2.${round} re-tap → 1 / 12, panel filled`, s.page === 1 && s.metricPage === "1 / 12" && /12쪽/.test(s.fileInfo) && /ms$/.test(s.ttfp) && /ms$/.test(s.load) && s.renders > 0, JSON.stringify(s));
  }
  await shot(page, `${OUT}/f01-mobile-retap.png`, { fullPage: true });
  // switch sample → other sample, then back
  await page.tap('[data-sample="proposal"]');
  await waitPanel(page, () => document.querySelector('[data-metric="page"]')?.textContent === "1 / 58");
  s = await panel(page);
  check("M3 switch to proposal → 1 / 58", s.metricPage === "1 / 58" && /58쪽/.test(s.fileInfo), JSON.stringify(s));
  check("M4 no console errors (mobile)", bad(logs).length === 0, bad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ── 2. Desktop: click sample → focus goes to viewer; ArrowRight, Space, Shift+Space; re-click + Space ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-sample="presentation"]');
  await page.click('[data-sample="presentation"]');
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await sleep(400);
  let s = await panel(page);
  check("D1 focus moved to viewer after sample click", s.focus === "viewer", s.focus);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await sleep(500);
  s = await panel(page);
  check("D2 ArrowRight + Space → 3 / 12, panel live", s.page === 3 && s.metricPage === "3 / 12", JSON.stringify(s));
  await page.keyboard.down("Shift"); await page.keyboard.press("Space"); await page.keyboard.up("Shift");
  await sleep(400);
  s = await panel(page);
  check("D3 Shift+Space → 2", s.page === 2, s.indicator);
  await shot(page, `${OUT}/f02-desktop-space.png`);
  await page.click('[data-sample="presentation"]');
  await waitPanel(page, () => /ms$/.test(document.querySelector('[data-metric="ttfp"]')?.textContent ?? ""));
  await page.keyboard.press("Space");
  await sleep(500);
  s = await panel(page);
  check("D4 re-click sample then Space → 2 / 12 (restart + advance)", s.page === 2 && s.metricPage === "2 / 12" && /ms$/.test(s.ttfp), JSON.stringify(s));
  // main-thread checkbox resets metrics too
  await page.click('input[type="checkbox"]');
  await waitPanel(page, () => document.querySelector('[data-metric="renderer"]')?.textContent === "메인 스레드");
  s = await panel(page);
  check("D5 main-thread toggle → fresh metrics", s.page === 1 && /ms$/.test(s.ttfp), JSON.stringify(s));
  // F toggles fullscreen exactly once per press (no duplicate request from a StrictMode-doubled updater).
  // Focus is on the checkbox (form control → keys ignored by design), so click the slide first.
  const vb = await (await page.$("[data-slide-viewport]")).boundingBox();
  await page.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.keyboard.press("f");
  await sleep(500);
  const fs1 = await page.evaluate(() => ({ attr: document.querySelector("[data-state]").dataset.fullscreen, native: !!document.fullscreenElement }));
  await page.keyboard.press("f");
  await sleep(500);
  const fs2 = await page.evaluate(() => ({ attr: document.querySelector("[data-state]").dataset.fullscreen, native: !!document.fullscreenElement }));
  check("D6 F → fullscreen on, F → off (state and native agree)", fs1.attr === "true" && fs2.attr === "false" && !fs2.native, JSON.stringify({ fs1, fs2 }));
  await page.click('[data-action="fullscreen"]'); await sleep(400);
  const fs3 = await page.evaluate(() => document.querySelector("[data-state]").dataset.fullscreen);
  await page.keyboard.press("Escape"); await sleep(400);
  const fs4 = await page.evaluate(() => document.querySelector("[data-state]").dataset.fullscreen);
  check("D7 button opens, Esc closes", fs3 === "true" && fs4 === "false", `${fs3}→${fs4}`);
  check("D8 no console errors (desktop)", bad(logs).length === 0, bad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ── 3. Mixed landscape/portrait deck: stageAspect="current" on /slide ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
  const input = await page.waitForSelector('[data-testid="pdf-input"]');
  await input.uploadFile(".verify/slide/review/mixed.pdf");
  await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
  await sleep(500);
  const box = () => page.evaluate(() => {
    const r = Number(document.querySelector("[data-state]").dataset.page);
    const h = document.querySelector(`[data-page-host="${r}"]`).getBoundingClientRect();
    const v = document.querySelector("[data-slide-viewport]").getBoundingClientRect();
    return { page: r, hw: Math.round(h.width), hh: Math.round(h.height), vw: Math.round(v.width), vh: Math.round(v.height) };
  });
  const b1 = await box();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector('[data-page-host="2"]')?.dataset.renderState === "done");
  await sleep(600);
  const b2 = await box();
  await shot(page, `${OUT}/f03-mixed-portrait-page.png`);
  check("X1 portrait page 2 shown large (stage follows page aspect)", b2.hh > 400 && Math.abs(b2.hw / b2.hh - 595 / 842) < 0.02 && b2.hh <= b2.vh + 1, JSON.stringify({ b1, b2 }));
  await page.keyboard.press("ArrowLeft");
  await sleep(700);
  const b3 = await box();
  const canvasOk = await page.evaluate(() => {
    const c = document.querySelector('[data-page-host="1"] canvas');
    return c ? { cw: c.width, dpr: devicePixelRatio, hostW: Math.round(c.parentElement.getBoundingClientRect().width) } : null;
  });
  check("X2 back to landscape page 1: stage shrinks back, re-rendered sharp", b3.vh < b2.vh && Math.abs(b3.hw - b1.hw) <= 1 && canvasOk && Math.abs(canvasOk.cw - canvasOk.hostW * canvasOk.dpr) < 4, JSON.stringify({ b3, canvasOk }));
  check("X3 no console errors (mixed)", bad(logs).length === 0, bad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

// ── 4. /slide/embed: default keyboard="focus", two viewers ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/slide/embed`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll('[data-state="ready"]').length === 2, { timeout: 30000 });
  await sleep(500);
  const pages = () => page.evaluate(() => [...document.querySelectorAll("[data-slide-viewer]")].map((r) => Number(r.dataset.page)));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await sleep(400);
  check("E1 keys with nothing focused move neither viewer", JSON.stringify(await pages()) === "[1,1]", JSON.stringify(await pages()));
  const vA = await page.$('[data-embed="a"] [data-slide-viewport]');
  const bb = await vA.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await sleep(400);
  check("E2 click viewer A → ←/→ move only A", JSON.stringify(await pages()) === "[3,1]", JSON.stringify(await pages()));
  await page.click('[data-embed="b"] [data-action="next"]');
  await page.keyboard.press("ArrowRight");
  await sleep(400);
  check("E3 press B's next button → keys now move only B", JSON.stringify(await pages()) === "[3,3]", JSON.stringify(await pages()));
  await shot(page, `${OUT}/f04-embed-two-viewers.png`);
  check("E4 no console errors (embed)", bad(logs).length === 0, bad(logs).slice(0, 3).join(" ; "));
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
