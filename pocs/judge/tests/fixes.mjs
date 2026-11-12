// Round-1 fix verification for /judge. node judge/tests/fixes.mjs  (does ONE real regenerate ≈10s)
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/judge/fix1";
const R = [];
const ok = (n, c, x = "") => { R.push(`${c ? "PASS" : "FAIL"} ${n} ${x}`); console.log(R.at(-1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (page, sel) => page.$$eval(sel, (e) => e.length);

// ── mobile ──
{
  const { browser, page, logs } = await launch({ mobile: true });
  const imgBytes = { card: 0, full: 0, thumb: 0, n: 0 };
  const posts = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/api/judge/image/")) {
      const len = r.status() === 200 ? (await r.buffer().catch(() => Buffer.alloc(0))).length : 0;
      const k = u.includes("size=card") ? "card" : u.includes("size=thumb") ? "thumb" : "full";
      imgBytes[k] += len;
      imgBytes.n++;
    }
  });
  page.on("request", (q) => { if (q.method() === "POST" && q.url().endsWith("/api/judge")) posts.push(q.postData()); });

  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"]', { timeout: 20000 });
  const n0 = await count(page, '[data-testid="judge-card"]');
  await shot(page, `${OUT}/m-top.png`);

  // #7 quality is no longer a visible primary input
  const qualityVisible = await page.$eval('[data-testid="quality"]', (el) => el.checkVisibility());
  const radiogroups = await page.$$eval('[role="radiogroup"]', (gs) => gs.filter((g) => g.checkVisibility()).map((g) => g.getAttribute("aria-label")));
  ok("only temperament radiogroup visible", !qualityVisible && radiogroups.length === 1 && radiogroups[0] === "심사위원 성향", JSON.stringify(radiogroups));

  // #6 cards use the 512px card variant (scroll whole gallery so lazy images load)
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); });
  await sleep(1500);
  const srcs = await page.$$eval('[data-testid="judge-card"] img', (is) => is.map((i) => i.currentSrc));
  const allCard = srcs.every((s) => s.includes("size=card"));
  ok("card imgs load size=card", allCard && srcs.length === n0, `${srcs.length} imgs; sample=${srcs[0]?.split("/api")[1]}`);
  ok("gallery image bytes", imgBytes.full === 0, `card=${(imgBytes.card / 1024).toFixed(0)}KB full=${(imgBytes.full / 1024).toFixed(0)}KB over ${imgBytes.n} reqs (${n0} cards)`);

  // #1 regenerate from the detail sheet: progress, locked buttons, single request, in-place replace
  const first = await page.$eval('[data-testid="judge-card"]', (a) => ({ id: a.dataset.judgeId, name: a.querySelector("h3").textContent }));
  await page.click(`[data-judge-id="${first.id}"] button`);
  await page.waitForSelector('dialog[open][data-testid="judge-detail"]');
  posts.length = 0;
  const t0 = Date.now();
  await page.click('[data-testid="detail-regenerate"]');
  await sleep(150);
  const st = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    const b = d.querySelector('[data-testid="detail-regenerate"]');
    const del = d.querySelector('button[aria-label$="삭제"]');
    return { regenDisabled: b.disabled, delDisabled: del.disabled, overlay: !!d.querySelector('[data-testid="detail-regenerating"]'), text: b.textContent };
  });
  ok("detail shows progress + locks buttons", st.regenDisabled && st.delDisabled && st.overlay, JSON.stringify(st));
  // hammer: second tap + forced programmatic clicks on regen and delete
  await page.click('[data-testid="detail-regenerate"]').catch(() => {});
  await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    d.querySelector('[data-testid="detail-regenerate"]').click();
    d.querySelector('button[aria-label$="삭제"]').click();
  });
  await sleep(2500);
  await shot(page, `${OUT}/m-detail-regenerating.png`);
  // also try the card's own regenerate button (behind the modal) via JS
  await page.evaluate((id) => document.querySelector(`[data-judge-id="${id}"] .flex-1`)?.click(), first.id);
  await page.waitForFunction((id) => !document.querySelector(`[data-judge-id="${id}"]`), { timeout: 120000 }, first.id);
  await sleep(600);
  const n1 = await count(page, '[data-testid="judge-card"]');
  const dlg = await page.evaluate(() => ({ open: !!document.querySelector("dialog[open]"), name: document.querySelector("#judge-detail-title")?.textContent, busy: !!document.querySelector('[data-testid="detail-regenerating"]') }));
  ok("exactly 1 POST despite 4 taps", posts.length === 1, `posts=${posts.length} ${posts[0] ?? ""}`);
  ok("replaced in place, count unchanged", n1 === n0, `before=${n0} after=${n1} ${((Date.now() - t0) / 1000).toFixed(1)}s ${first.name} → ${dlg.name}`);
  ok("dialog now shows the new judge", dlg.open && !dlg.busy && dlg.name && dlg.name !== first.name, JSON.stringify(dlg));
  await page.waitForFunction(() => { const i = document.querySelector("dialog[open] img"); return i && i.complete && i.naturalWidth > 0; }, { timeout: 15000 });
  await shot(page, `${OUT}/m-detail-after-regen.png`);
  await page.keyboard.press("Escape");
  await sleep(300);

  // #8 panel stream that closes cleanly after "start" only → slots become error cards, timers stop
  await page.setRequestInterception(true);
  page.on("request", (q) => {
    if (q.isInterceptResolutionHandled()) return;
    if (q.method() === "POST" && q.url().endsWith("/api/judge/panel"))
      return q.respond({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "start", slots: [0, 1, 2].map((slot) => ({ slot, temperament: ["friendly", "strict", "aggressive"][slot] })) }) + "\n" });
    q.continue();
  });
  await page.click('[data-testid="btn-panel"]');
  await sleep(1200);
  const sk = await count(page, '[data-testid="judge-skeleton"]');
  const errs = await page.$$eval('[data-testid="judge-error"]', (es) => es.map((e) => e.dataset.errorKind));
  ok("truncated panel stream → 3 error cards, 0 skeletons", sk === 0 && errs.length === 3 && errs.every((k) => k === "server"), `skeletons=${sk} errors=${errs.join(",")}`);
  await page.evaluate(() => document.querySelector('[data-testid="gallery"]').scrollIntoView());
  await shot(page, `${OUT}/m-panel-truncated.png`);
  for (let i = 0; i < 3; i++) await page.click('[data-testid="judge-error"] button[aria-label="오류 닫기"]');
  await page.setRequestInterception(false);

  // dev options panel (quality moved here)
  await page.evaluate(() => { const d = document.querySelector('[data-testid="dev-errors"]'); d.open = true; d.scrollIntoView(); });
  await sleep(300);
  await shot(page, `${OUT}/m-dev-options.png`);

  const consoleErrs = logs.filter((l) => /\[(error|pageerror|requestfailed)\]/.test(l));
  ok("mobile console clean", consoleErrs.length === 0, consoleErrs.join(" || ").slice(0, 400));
  await browser.close();
}

// ── desktop ──
{
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="judge-card"] img');
  await sleep(800);
  const src = await page.$eval('[data-testid="judge-card"] img', (i) => i.currentSrc);
  ok("desktop card src", src.includes("size=card") || src.includes("size=thumb"), src.split("/api")[1]);
  await shot(page, `${OUT}/d-top.png`);
  const consoleErrs = logs.filter((l) => /\[(error|pageerror|requestfailed)\]/.test(l));
  ok("desktop console clean", consoleErrs.length === 0, consoleErrs.join(" || ").slice(0, 400));
  await browser.close();
}
console.log("\n" + R.join("\n"));
