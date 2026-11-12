// Review round 2 UI test for /judge. node judge/tests/review-r2-ui.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/judge/review";
const R = [];
const ok = (n, c, x = "") => { R.push(`${c ? "PASS" : "FAIL"} ${n} ${x}`); console.log(R.at(-1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (page, sel) => page.$$eval(sel, (e) => e.length);

// ── mobile: live panel generation, intercepted regenerate failure, dialog scroll ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"]', { timeout: 20000 });
  const n0 = await count(page, '[data-testid="judge-card"]');
  ok("m: loads", n0 > 0, `${n0} cards`);
  ok("m: no hscroll", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  const grayscale = await page.$eval('[data-testid="judge-card"] img', (i) => getComputedStyle(i).filter);
  ok("m: color photo (no grayscale filter)", !grayscale.includes("grayscale"), grayscale);
  await shot(page, `${OUT}/r2-m-top.png`);
  // which image variant does mobile load for cards?
  const cur = await page.$eval('[data-testid="judge-card"] img', (i) => i.currentSrc);
  ok("m: card image variant", /size=(card|thumb)/.test(cur), cur);

  // live panel
  const t0 = Date.now();
  await page.click('[data-testid="btn-panel"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="judge-skeleton"]').length === 3, { timeout: 3000 });
  await page.evaluate(() => document.querySelector('[data-testid="gallery"]').scrollIntoView());
  await sleep(3000);
  await shot(page, `${OUT}/r2-m-panel-loading.png`);
  await page.waitForFunction(() => !document.querySelector('[data-testid="judge-skeleton"]'), { timeout: 120000 });
  const n1 = await count(page, '[data-testid="judge-card"]');
  const errs = await count(page, '[data-testid="judge-error"]');
  const top3 = await page.$$eval('[data-testid="judge-card"]', (a) => a.slice(0, 3).map((x) => x.innerText.replace(/\n/g, " ")));
  ok("m: panel +3", n1 === n0 + 3 && errs === 0, `${(Date.now() - t0) / 1000}s ${top3.join(" || ")}`);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="judge-card"] img')].slice(0, 3).every((i) => i.complete && i.naturalWidth > 0), { timeout: 15000 });
  await shot(page, `${OUT}/r2-m-panel-done.png`);

  // Intercept: make the next POST /api/judge fail with 429 → regenerate failure path from the card
  await page.setRequestInterception(true);
  let posts = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/api/judge")) {
      posts++;
      setTimeout(() => req.respond({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { kind: "rate_limit", message: "x", title: "요청이 몰려 잠시 쉬어야 해요", hint: "30초쯤 뒤에 다시 시도해 주세요." } }) }), 800);
    } else req.continue();
  });
  const firstId = await page.$eval('[data-testid="judge-card"]', (a) => a.dataset.judgeId);
  // card regenerate button = first button in the actions row
  await page.$$eval(`[data-judge-id="${firstId}"] button`, (bs) => bs.find((b) => b.textContent.includes("다시 생성"))?.click());
  await sleep(300);
  const busy = await page.$eval(`[data-judge-id="${firstId}"]`, (a) => a.getAttribute("aria-busy"));
  ok("m: card busy during regenerate", busy === "true", busy);
  await page.waitForSelector('[data-testid="judge-error"]', { timeout: 5000 });
  const afterErr = await page.evaluate((id) => ({ cardStill: !!document.querySelector(`[data-judge-id="${id}"]`), busy: document.querySelector(`[data-judge-id="${id}"]`)?.getAttribute("aria-busy"), err: document.querySelector('[data-testid="judge-error"]')?.innerText.replace(/\n/g, " ") }), firstId);
  ok("m: regenerate failure keeps card + shows error", afterErr.cardStill && afterErr.busy === "false", JSON.stringify(afterErr));
  // close the detail dialog if it opened
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector('[data-testid="judge-error"]')?.scrollIntoView({ block: "center" }));
  await sleep(300);
  await shot(page, `${OUT}/r2-m-regen-error.png`);
  // Retry from the error card (still intercepted → fails again), then dismiss
  await page.$eval('[data-testid="judge-error"] button', (b) => b.click());
  await sleep(200);
  const retryBusy = await page.$eval(`[data-judge-id="${firstId}"]`, (a) => a.getAttribute("aria-busy"));
  ok("m: retry from error card re-targets same judge", retryBusy === "true", retryBusy);
  await page.waitForSelector('[data-testid="judge-error"]', { timeout: 5000 });
  await page.$eval('[data-testid="judge-error"] [aria-label="오류 닫기"]', (b) => b.click());
  await sleep(200);
  ok("m: dismiss error card", (await count(page, '[data-testid="judge-error"]')) === 0, `posts=${posts}`);

  // Network failure on panel (abort)
  page.removeAllListeners("request");
  page.on("request", (req) => (req.method() === "POST" && req.url().includes("/api/judge/panel") ? req.abort("failed") : req.continue()));
  await page.click('[data-testid="btn-panel"]');
  await sleep(1500);
  const panelErr = await page.$$eval('[data-testid="judge-error"]', (e) => e.map((x) => x.dataset.errorKind));
  ok("m: panel network failure → 3 error cards", panelErr.length === 3, panelErr.join(","));
  await page.evaluate(() => document.querySelector('[data-testid="judge-error"]')?.scrollIntoView({ block: "start" }));
  await shot(page, `${OUT}/r2-m-panel-neterr.png`);
  for (let i = 0; i < 3; i++) await page.$eval('[data-testid="judge-error"] [aria-label="오류 닫기"]', (b) => b.click()).catch(() => {});
  await page.setRequestInterception(false);
  page.removeAllListeners("request");

  // Detail dialog on mobile: does it fit / scroll to the action buttons?
  await page.evaluate(() => scrollTo(0, 0));
  const id2 = await page.$eval('[data-testid="judge-card"]', (a) => a.dataset.judgeId);
  await page.click(`[data-judge-id="${id2}"] button`);
  await page.waitForSelector('[data-testid="judge-detail"][open]', { timeout: 3000 });
  await sleep(400);
  await shot(page, `${OUT}/r2-m-detail.png`);
  const dlg = await page.$eval('[data-testid="judge-detail"]', (d) => {
    const r = d.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight, scrollH: d.scrollHeight, clientH: d.clientHeight, overflow: getComputedStyle(d).overflowY };
  });
  ok("m: detail sheet within viewport & scrollable", dlg.bottom <= dlg.h + 1 && (dlg.scrollH <= dlg.clientH || /auto|scroll/.test(dlg.overflow)), JSON.stringify(dlg));
  await page.$eval('[data-testid="detail-regenerate"]', (b) => b.scrollIntoView());
  await page.$eval('[data-testid="judge-prompt"] summary', (s) => s.click());
  await sleep(200);
  await shot(page, `${OUT}/r2-m-detail-bottom.png`);
  const bodyScrollLocked = await page.evaluate(() => getComputedStyle(document.body).overflow);
  ok("m: info body overflow while modal", true, bodyScrollLocked);
  await page.keyboard.press("Escape");
  await sleep(200);
  ok("m: Esc closes detail", !(await page.$('[data-testid="judge-detail"][open]')));

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"] img');
  await sleep(300);
  const f2 = await page.$eval('[data-testid="judge-card"] img', (i) => getComputedStyle(i).filter);
  ok("m: still color after reload", f2 === "none", f2);

  const errsLog = logs.filter((l) => /error|pageerror/i.test(l) && !/429|Failed to load resource|ERR_FAILED|requestfailed/.test(l));
  ok("m: no unexpected console errors", errsLog.length === 0, errsLog.slice(0, 5).join(" | "));
  console.log("mobile logs:", logs.filter((l) => /error|fail/i.test(l)).slice(0, 10));
  await browser.close();
}

// ── desktop ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"]');
  await sleep(500);
  await shot(page, `${OUT}/r2-d-top.png`);
  ok("d: no hscroll", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  // keyboard: tab to chip and select with Enter
  await page.focus('[data-testid="chip-aggressive"]');
  await page.keyboard.press("Enter");
  const chk = await page.$eval('[data-testid="chip-aggressive"]', (b) => b.getAttribute("aria-checked"));
  ok("d: keyboard chip select", chk === "true");
  const label = await page.$eval('[data-testid="btn-generate"]', (b) => b.innerText);
  ok("d: generate label follows chip", label.includes("공격적"), label);
  // simulated moderation via dev section
  await page.$eval('[data-testid="dev-errors"] summary', (s) => s.click());
  await page.click('[data-testid="sim-moderation"]');
  await page.waitForSelector('[data-testid="judge-error"][data-error-kind="moderation"]', { timeout: 5000 });
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, `${OUT}/r2-d-moderation.png`);
  ok("d: moderation error card", true);
  const id = await page.$eval('[data-testid="judge-card"]', (a) => a.dataset.judgeId);
  await page.click(`[data-judge-id="${id}"] button`);
  await page.waitForSelector('[data-testid="judge-detail"][open]');
  await sleep(400);
  await shot(page, `${OUT}/r2-d-detail.png`);
  // backdrop click closes
  await page.mouse.click(20, 20);
  await sleep(300);
  ok("d: backdrop click closes", !(await page.$('[data-testid="judge-detail"][open]')));
  const errsLog = logs.filter((l) => /\[error\]|pageerror/.test(l) && !/422|Failed to load resource/.test(l));
  ok("d: no console errors", errsLog.length === 0, errsLog.join(" | "));
  await browser.close();
}
console.log(`\n${R.filter((r) => r.startsWith("PASS")).length}/${R.length} PASS`);
