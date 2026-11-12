// Headless UI check for /wiki (mobile + desktop). Run from pocs/: node wiki/tests/ui.mjs [docId] [--live]
//  - loads /wiki?doc=..., renders overview, clicks a [[link]], opens a (p.N) raw sheet, runs a query (real LLM),
//    runs lint (with --live), views log; screenshots to .verify/wiki/; fails on console errors / horizontal overflow.
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const args = process.argv.slice(2);
const live = args.includes("--live");
const docId = args.find((a) => /^[a-f0-9]{16}$/.test(a));
const OUT = ".verify/wiki";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function noOverflow(page) {
  // every element's right edge must stay inside the layout width (catches grid tracks wider than the viewport)
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll("body *")].filter((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || getComputedStyle(e).position === "fixed") return false;
      let p = e.parentElement;
      while (p && p !== document.body) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll" || ov === "hidden") return false;
        p = p.parentElement;
      }
      return r.right > W + 1;
    });
    return bad.length === 0 && document.documentElement.scrollWidth <= W + 1;
  });
}
async function clickText(page, selector, text) {
  const ok = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim().includes(t));
      if (el) el.click();
      return !!el;
    },
    selector,
    text,
  );
  return ok;
}

for (const mobile of [true, false]) {
  const tag = mobile ? "mobile" : "desktop";
  const { browser, page, logs } = await launch({ mobile });
  page.on("response", (r) => r.status() >= 400 && logs.push(`[http ${r.status()}] ${r.url()}`));
  try {
    const url = `${BASE}/wiki${docId ? `?doc=${docId}` : ""}`;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForSelector("article h2", { timeout: 20000 });
    check(`${tag}: overview rendered`, true, `${Date.now() - t0}ms`);
    await shot(page, `${OUT}/${tag}-1-top.png`);
    await shot(page, `${OUT}/${tag}-2-overview-full.png`, { fullPage: true });
    check(`${tag}: no horizontal overflow (overview)`, await noOverflow(page));

    // [[link]] navigation
    const linked = await page.evaluate(() => {
      const b = [...document.querySelectorAll("article button")].find((e) => e.title?.includes("열기") && !e.title.includes("overview"));
      if (!b) return null;
      b.click();
      return b.textContent;
    });
    await sleep(900);
    const crumb = await page.evaluate(() => document.querySelector("article .font-medium.text-ink")?.textContent);
    check(`${tag}: [[link]] opens page`, !!linked && !!crumb && crumb !== "overview", `${linked} → ${crumb}`);

    // 주요-수치 page (table)
    await page.evaluate(() => {
      const u = new URL(location.href);
      u.searchParams.set("page", "주요-수치");
      history.replaceState(null, "", u);
    });
    await page.goto(page.url(), { waitUntil: "networkidle0" });
    await page.waitForSelector("article table", { timeout: 15000 });
    check(`${tag}: 주요-수치 table rendered`, true, `${await page.$$eval("article tbody tr", (r) => r.length)} rows`);
    await page.evaluate(() => document.querySelector("article")?.scrollIntoView({ block: "start" }));
    await sleep(300);
    await shot(page, `${OUT}/${tag}-3-numbers.png`);

    // (p.N) → raw sheet
    const cite = await page.evaluate(() => {
      const b = [...document.querySelectorAll("article button")].find((e) => /^p\.\d+/.test(e.textContent ?? ""));
      b?.click();
      return b?.textContent;
    });
    await page.waitForSelector('[role="dialog"] pre', { timeout: 10000 });
    await sleep(600);
    const rawText = await page.$eval('[role="dialog"] pre', (e) => e.textContent ?? "");
    check(`${tag}: citation opens raw page`, rawText.length > 20 && !rawText.includes("불러오는 중"), `${cite} · ${rawText.length} chars`);
    await shot(page, `${OUT}/${tag}-4-raw-sheet.png`);
    await page.keyboard.press("Escape");
    await sleep(300);

    // query tab
    await clickText(page, '[role="tab"]', "질의");
    await page.waitForSelector("#wiki-q");
    if (live || mobile) {
      await page.type("#wiki-q", "세트당 원가와 매출총이익률은?");
      await clickText(page, 'button[type="submit"]', "질의");
      const tq = Date.now();
      await page.waitForFunction(() => [...document.querySelectorAll("h3")].some((h) => h.textContent === "답변"), { timeout: 60000 });
      check(`${tag}: query answered`, true, `${Date.now() - tq}ms`);
      await sleep(400);
      const answer = await page.evaluate(() => [...document.querySelectorAll("h3")].find((h) => h.textContent === "답변")?.parentElement?.textContent ?? "");
      check(`${tag}: answer has figures + citations`, /142원/.test(answer) && /p\.\d+/.test(answer), answer.slice(0, 120));
      await shot(page, `${OUT}/${tag}-5-query.png`, { fullPage: true });
      check(`${tag}: no horizontal overflow (query)`, await noOverflow(page));
    }

    // lint tab
    await clickText(page, '[role="tab"]', "점검");
    await page.waitForSelector("#lint-against");
    if (live && !mobile) {
      const opts = await page.$$eval("#lint-against option", (o) => o.map((x) => [x.value, x.textContent]));
      const pres = opts.find(([, t]) => t?.includes("presentation"));
      if (pres) await page.select("#lint-against", pres[0]);
      await clickText(page, "button", "점검 실행");
      await page.waitForFunction(() => document.body.textContent?.includes("이슈 ") && !document.body.textContent.includes("점검 중…"), { timeout: 120000 });
      await sleep(400);
      const txt = await page.evaluate(() => document.body.textContent ?? "");
      check(`${tag}: lint (cross-doc) shows mismatch`, /문서 간 불일치/.test(txt) && /118원/.test(txt) && /142원/.test(txt));
    } else await sleep(1200);
    await shot(page, `${OUT}/${tag}-6-lint.png`, { fullPage: true });

    // log tab
    await clickText(page, '[role="tab"]', "log");
    await page.waitForFunction(() => document.querySelector("article")?.textContent?.includes("ingest"), { timeout: 10000 });
    check(`${tag}: log.md rendered`, true);
    await page.evaluate(() => document.querySelector("article")?.scrollIntoView({ block: "start" }));
    await sleep(300);
    await shot(page, `${OUT}/${tag}-7-log.png`);

    const errs = logs.filter((l) => /^\[(error|pageerror|http)/.test(l) && !/favicon/.test(l));
    check(`${tag}: no console errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
  } catch (e) {
    check(`${tag}: run`, false, e.message);
    await shot(page, `${OUT}/${tag}-error.png`).catch(() => {});
    console.log(logs.slice(-10).join("\n"));
  } finally {
    await browser.close();
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
