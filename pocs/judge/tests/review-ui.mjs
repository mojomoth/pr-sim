// Reviewer UI test for /judge. node judge/tests/review-ui.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/judge/review";
const R = [];
const ok = (n, c, x = "") => { R.push(`${c ? "PASS" : "FAIL"} ${n} ${x}`); console.log(R.at(-1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (page, sel) => page.$$eval(sel, (e) => e.length);

// ── mobile ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"]', { timeout: 20000 });
  const n0 = await count(page, '[data-testid="judge-card"]');
  ok("mobile loads", n0 > 0, `${n0} cards`);
  ok("mobile no hscroll", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await shot(page, `${OUT}/m-top.png`);
  // chips: is the only user input temperament (+quality)?
  const inputs = await page.$$eval('input,select,textarea', (e) => e.length);
  ok("no free-form inputs", inputs === 0, `inputs=${inputs}`);
  // tap target sizes on chips & buttons
  const small = await page.$$eval("button", (bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 40 || r.width < 40); }).map((b) => `${b.textContent.trim().slice(0, 12)}:${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`));
  ok("tap targets >=40px", small.length === 0, small.join(", "));

  // single live generation: strict
  await page.click('[data-testid="chip-strict"]');
  const t0 = Date.now();
  await page.click('[data-testid="btn-generate"]');
  await page.waitForSelector('[data-testid="judge-skeleton"]', { timeout: 3000 });
  await page.evaluate(() => document.querySelector('[data-testid="gallery"]').scrollIntoView());
  await sleep(2500);
  await shot(page, `${OUT}/m-skeleton.png`);
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="judge-card"]').length === n + 1 && !document.querySelector('[data-testid="judge-skeleton"]'), { timeout: 90000 }, n0);
  const first = await page.$eval('[data-testid="judge-card"]', (a) => ({ id: a.dataset.judgeId, text: a.innerText }));
  ok("single generate adds card at top", first.text.includes("빡셈"), `${(Date.now() - t0) / 1000}s ${first.text.replace(/\n/g, " | ")}`);
  await page.waitForFunction(() => { const i = document.querySelector('[data-testid="judge-card"] img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 10000 });
  await shot(page, `${OUT}/m-after-generate.png`);

  // open detail, regenerate from inside the dialog (double click to test guard)
  await page.click(`[data-judge-id="${first.id}"] button`);
  await page.waitForSelector('dialog[open][data-testid="judge-detail"]');
  await shot(page, `${OUT}/m-detail.png`);
  const regenBtn = await page.$('dialog[open] button.flex-1');
  await regenBtn.click();
  await sleep(150);
  const disabledAfterClick = await page.$eval('dialog[open] button.flex-1', (b) => b.disabled || b.getAttribute("aria-busy") === "true");
  const dlgText = await page.$eval('dialog[open]', (d) => d.innerText);
  ok("detail regen shows progress/disabled", disabledAfterClick || /생성 중/.test(dlgText), `disabled=${disabledAfterClick}`);
  await regenBtn.click(); // second click: does it fire a 2nd request?
  await sleep(1500);
  await shot(page, `${OUT}/m-detail-regenerating.png`);
  const nBefore = await count(page, '[data-testid="judge-card"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="judge-skeleton"]') && !document.querySelector('[aria-busy="true"][data-testid="judge-card"]'), { timeout: 120000 });
  await sleep(500);
  const nAfter = await count(page, '[data-testid="judge-card"]');
  const stillOld = await page.$(`[data-judge-id="${first.id}"]`);
  const dialogOpen = !!(await page.$('dialog[open]'));
  const dlgName = dialogOpen ? await page.$eval('#judge-detail-title', (h) => h.textContent) : null;
  ok("regen replaced in place (1 click)", !stillOld && nAfter === nBefore, `before=${nBefore} after=${nAfter} dialogOpen=${dialogOpen} name=${dlgName}`);
  await shot(page, `${OUT}/m-after-regen.png`);
  if (dialogOpen) { await page.keyboard.press("Escape"); await sleep(300); }

  // delete newest card + persistence after reload
  const victim = await page.$eval('[data-testid="judge-card"]', (a) => a.dataset.judgeId);
  await page.click(`[data-judge-id="${victim}"] button[aria-label$="삭제"]`);
  await sleep(800);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"]');
  ok("delete persists after reload", !(await page.$(`[data-judge-id="${victim}"]`)));

  // simulated error, then retry
  await page.evaluate(() => (document.querySelector('[data-testid="dev-errors"]').open = true));
  await page.click('[data-testid="sim-moderation"]');
  await page.waitForSelector('[data-testid="judge-error"]', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('[data-testid="gallery"]').scrollIntoView());
  await shot(page, `${OUT}/m-error.png`);
  ok("error card", true);
  await page.click('[data-testid="judge-error"] button[aria-label="오류 닫기"]');

  const errs = logs.filter((l) => /\[(error|pageerror|requestfailed)\]/.test(l));
  ok("mobile console clean", errs.length === 0, errs.join(" || ").slice(0, 600));
  await browser.close();
}

// ── desktop ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"]');
  await shot(page, `${OUT}/d-top.png`);
  const n0 = await count(page, '[data-testid="judge-card"]');
  const t0 = Date.now();
  await page.click('[data-testid="btn-panel"]');
  await sleep(300);
  ok("panel shows 3 skeletons", (await count(page, '[data-testid="judge-skeleton"]')) === 3);
  await sleep(3000);
  await shot(page, `${OUT}/d-panel-loading.png`);
  await page.waitForFunction(() => !document.querySelector('[data-testid="judge-skeleton"]'), { timeout: 120000 });
  const n1 = await count(page, '[data-testid="judge-card"]');
  const top3 = await page.$$eval('[data-testid="judge-card"]', (as) => as.slice(0, 3).map((a) => a.innerText.split("\n").slice(0, 3).join(" ")));
  ok("panel adds 3", n1 === n0 + 3, `${(Date.now() - t0) / 1000}s ${top3.join(" / ")}`);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="judge-card"] img')].slice(0, 3).every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 });
  await shot(page, `${OUT}/d-after-panel.png`);
  await page.click('[data-testid="judge-card"] button');
  await page.waitForSelector("dialog[open]");
  await sleep(300);
  await shot(page, `${OUT}/d-detail.png`);
  // focus moved into dialog?
  const focusInDialog = await page.evaluate(() => !!document.activeElement?.closest("dialog"));
  ok("dialog focus", focusInDialog);
  await page.mouse.click(10, 10); // backdrop click
  await sleep(300);
  ok("backdrop click closes", !(await page.$("dialog[open]")));
  const errs = logs.filter((l) => /\[(error|pageerror|requestfailed)\]/.test(l));
  ok("desktop console clean", errs.length === 0, errs.join(" || ").slice(0, 600));
  await browser.close();
}
console.log("\n" + R.join("\n"));
