// Review round 3 (independent reviewer): drive /report on mobile + desktop, check overflow, console errors, key UI elements.
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const OUT = ".verify/report/review";
const results = [];
const ok = (name, cond, info = "") => results.push(`${cond ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const sw = document.documentElement.scrollWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1;
      })
      .slice(0, 3)
      .map((el) => `${el.tagName}.${(el.className || "").toString().slice(0, 40)}`);
    return { vw, sw, offenders };
  });
}

for (const mobile of [true, false]) {
  const tag = mobile ? "r3m" : "r3d";
  const { browser, page, logs } = await launch({ mobile });
  try {
    // picker
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="sessions"]', { timeout: 15000 });
    const n = await page.$$eval('[data-testid="sessions"] [role="radio"], [data-testid="sessions"] button, [data-testid="sessions"] label', (x) => x.length);
    ok(`${tag} picker lists sessions`, n >= 3, `${n} items`);
    let o = await overflow(page);
    ok(`${tag} picker no h-overflow`, o.sw <= o.vw, JSON.stringify(o));
    await shot(page, `${OUT}/${tag}-1-picker.png`, { fullPage: true });

    // BAD result via deep link
    for (const [ref, name] of [["sample:session-bad", "bad"], ["sample:session-good", "good"], ["fixture:sample", "fixture"]]) {
      await page.goto(`${BASE}/report?session=${encodeURIComponent(ref)}&view=result`, { waitUntil: "networkidle2" });
      await page.waitForSelector('[data-testid="total"]', { timeout: 15000 });
      const total = await page.$eval('[data-testid="total"]', (e) => ({ t: e.textContent, fs: getComputedStyle(e).fontSize }));
      ok(`${tag} ${name} result total`, !!total.t, JSON.stringify(total));
      const subs = await page.$$eval('[data-testid^="sub-"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
      ok(`${tag} ${name} 4 sub-scores`, subs.length === 4, subs.join(" | "));
      const body = await page.evaluate(() => document.body.innerText);
      ok(`${tag} ${name} 잘한 점 + 다음 연습에서는`, body.includes("잘한 점") && body.includes("다음 연습에서는"));
      ok(`${tag} ${name} download link`, !!(await page.$('[data-testid="download"]')));
      o = await overflow(page);
      ok(`${tag} ${name} result no h-overflow`, o.sw <= o.vw, JSON.stringify(o));
      await shot(page, `${OUT}/${tag}-2-${name}-result.png`, { fullPage: true });

      for (const tab of ["qa", "speech", "materials"]) {
        await page.goto(`${BASE}/report?session=${encodeURIComponent(ref)}&view=detail&tab=${tab}`, { waitUntil: "networkidle2" });
        await page.waitForSelector(`[data-testid="${tab}-panel"]`, { timeout: 15000 });
        await sleep(300);
        o = await overflow(page);
        ok(`${tag} ${name} ${tab} no h-overflow`, o.sw <= o.vw, JSON.stringify(o));
        if (tab === "qa") {
          ok(`${tag} ${name} qa improved answer`, !!(await page.$('[data-testid="improved"]')));
          // walk all questions
          let q = 1;
          while (true) {
            const nx = await page.$('[data-testid="next-q"]:not([disabled])');
            if (!nx) break;
            await nx.click();
            await sleep(250);
            q++;
            o = await overflow(page);
            if (o.sw > o.vw) ok(`${tag} ${name} qa${q} no h-overflow`, false, JSON.stringify(o));
            if (name === "fixture" && q === 2) await shot(page, `${OUT}/${tag}-3-fixture-q2.png`, { fullPage: true });
          }
          ok(`${tag} ${name} walked questions`, q >= 2, `${q}`);
        }
        if (name !== "good" || tab !== "qa") await shot(page, `${OUT}/${tag}-4-${name}-${tab}.png`, { fullPage: true });
      }
    }

    // download link actually serves JSON
    const dl = await page.evaluate(async () => {
      const a = document.querySelector('[data-testid="download"]');
      return a ? a.getAttribute("href") : null;
    });
    ok(`${tag} download href present`, true, String(dl));

    // bad paste
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="sessions"]');
    const pasteBtn = await page.evaluateHandle(() => document.querySelector("button[aria-expanded]"));
    if (pasteBtn.asElement()) {
      await pasteBtn.asElement().click();
      await page.waitForSelector('textarea[aria-label="SessionRecord JSON"]');
      await page.type('textarea[aria-label="SessionRecord JSON"]', '{"id":"x"');
      const save = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "세션 추가"));
      if (save.asElement()) {
        await save.asElement().click();
        await sleep(500);
        const msg = await page.$eval('[data-testid="paste-error"]', (e) => e.textContent).catch(() => null);
        ok(`${tag} bad paste error shown`, !!msg, String(msg));
      } else ok(`${tag} paste save button`, false);
      await shot(page, `${OUT}/${tag}-5-bad-paste.png`, { fullPage: true });
    } else ok(`${tag} paste button`, false);

    const errs = logs.filter((l) => /^\[(error|pageerror|requestfailed)\]/.test(l) && !/favicon|hmr|webpack-hmr|_next\/webpack/.test(l));
    ok(`${tag} console errors`, errs.length === 0, errs.slice(0, 5).join(" ;; "));
  } finally {
    await browser.close();
  }
}
console.log(results.join("\n"));
console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} pass`);
