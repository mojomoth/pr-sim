// Headless UI test for /judge. node judge/tests/ui.mjs [--live]
// --live also clicks "3명 한 번에 생성" and waits for real gpt-image-2 results.
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const live = process.argv.includes("--live");
const OUT = ".verify/judge";
const results = [];
const ok = (name, cond, extra = "") => { results.push(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`); };

for (const mobile of [true, false]) {
  const tag = mobile ? "mobile" : "desktop";
  const { browser, page, logs } = await launch({ mobile });
  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"], [data-testid="empty"]', { timeout: 20000 });
  const n0 = await page.$$eval('[data-testid="judge-card"]', (e) => e.length);
  ok(`${tag} gallery loads`, true, `${n0} cards`);
  const gray = await page.$eval('[data-testid="judge-card"] img', (i) => getComputedStyle(i).filter).catch(() => "none");
  ok(`${tag} color photo (no grayscale filter)`, !gray.includes("grayscale"), gray);
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(`${tag} no horizontal scroll`, !hscroll);
  await shot(page, `${OUT}/ui-${tag}.png`);
  await shot(page, `${OUT}/ui-${tag}-full.png`, { fullPage: true });

  // detail sheet + prompt
  await page.click('[data-testid="judge-card"] button');
  await page.waitForSelector('dialog[open][data-testid="judge-detail"]', { timeout: 5000 });
  await page.click('[data-testid="judge-prompt"] summary');
  await new Promise((r) => setTimeout(r, 300));
  const promptLen = await page.$eval('[data-testid="judge-prompt"] pre', (p) => p.textContent.length);
  ok(`${tag} detail + prompt`, promptLen > 200, `prompt ${promptLen} chars`);
  await shot(page, `${OUT}/ui-${tag}-detail.png`);
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));
  ok(`${tag} detail closes`, !(await page.$('dialog[open][data-testid="judge-detail"]')));

  // simulated error states (no API spend)
  if (mobile) {
    await page.evaluate(() => (document.querySelector('[data-testid="dev-errors"]').open = true));
    await page.click('[data-testid="sim-moderation"]');
    await page.click('[data-testid="sim-rate_limit"]');
    await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-testid="gallery"]').getBoundingClientRect().top + window.scrollY - 80));
    await page.waitForSelector('[data-testid="judge-skeleton"]', { timeout: 3000 });
    await shot(page, `${OUT}/ui-mobile-skeleton-sim.png`);
    await page.waitForSelector('[data-testid="judge-error"][data-error-kind="moderation"]', { timeout: 8000 });
    await page.waitForSelector('[data-testid="judge-error"][data-error-kind="rate_limit"]', { timeout: 8000 });
    ok("mobile error cards", true);
    await shot(page, `${OUT}/ui-mobile-errors.png`);
    // dismiss them
    for (const b of await page.$$('[data-testid="judge-error"] button[aria-label="오류 닫기"]')) await b.click();
  }

  if (live && mobile) {
    const before = await page.$$eval('[data-testid="judge-card"]', (e) => e.length);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('[data-testid="btn-panel"]');
    const t0 = Date.now();
    await page.waitForSelector('[data-testid="judge-skeleton"]', { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 4000));
    await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-testid="gallery"]').getBoundingClientRect().top + window.scrollY - 80));
    await shot(page, `${OUT}/ui-mobile-panel-loading.png`);
    await page.waitForFunction(() => !document.querySelector('[data-testid="judge-skeleton"]'), { timeout: 240000 });
    const after = await page.$$eval('[data-testid="judge-card"]', (e) => e.length);
    const errs = await page.$$eval('[data-testid="judge-error"]', (e) => e.length);
    ok("live panel via UI", after - before === 3 && errs === 0, `+${after - before} cards, ${errs} errors, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await shot(page, `${OUT}/ui-mobile-panel-done.png`);
    // single generate (strict) + regenerate the newest
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('[data-testid="chip-strict"]');
    await page.click('[data-testid="btn-generate"]');
    const t1 = Date.now();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="judge-card"]').length === n && !document.querySelector('[data-testid="judge-skeleton"]'), { timeout: 120000 }, after + 1);
    ok("live single generate (strict)", true, `${((Date.now() - t1) / 1000).toFixed(1)}s`);
    const firstId = await page.$eval('[data-testid="judge-card"]', (e) => e.dataset.judgeId);
    await page.click('[data-testid="judge-card"] button:not([aria-label])'); // 다시 생성
    await page.waitForSelector('[data-testid="judge-card"][aria-busy="true"]', { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-testid="gallery"]').getBoundingClientRect().top + window.scrollY - 80));
    await shot(page, `${OUT}/ui-mobile-regenerating.png`);
    await page.waitForFunction((id) => !document.querySelector(`[data-judge-id="${id}"]`) && !document.querySelector('[aria-busy="true"]'), { timeout: 120000 }, firstId);
    const n2 = await page.$$eval('[data-testid="judge-card"]', (e) => e.length);
    ok("live regenerate replaces in place", n2 === after + 1, `${n2} cards`);
    // delete newest
    await page.click('[data-testid="judge-card"] button[aria-label$="삭제"]');
    await new Promise((r) => setTimeout(r, 800));
    const n3 = await page.$$eval('[data-testid="judge-card"]', (e) => e.length);
    ok("delete", n3 === after, `${n3} cards`);
  }

  const bad = logs.filter((l) => /\[(error|pageerror)\]/.test(l) && !/422|429|status of 4/.test(l));
  ok(`${tag} no console errors`, bad.length === 0, bad.join(" | "));
  await browser.close();
}
console.log(results.join("\n"));
