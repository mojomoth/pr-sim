// Headless-Chrome UI test for /report (own browser via scripts/browser.mjs). Screenshots → .verify/report/
//   node report/tests/ui.mjs            cached reports only (needs fixture:sample, sample:session-bad/good generated)
//   node report/tests/ui.mjs --live     + paste a new session in the UI and generate it live (real LLM calls, ~1 min)
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import { readFileSync } from "node:fs";

const OUT = ".verify/report";
const live = process.argv.includes("--live");
const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > w + 1 && getComputedStyle(el).position !== "fixed").map((el) => el.tagName + "." + (el.className?.toString?.() ?? "").slice(0, 40));
    return { scroll: document.documentElement.scrollWidth > w + 1, bad: bad.slice(0, 5) };
  });
}
async function clickText(page, text, sel = "button, a") {
  const ok = await page.evaluate(
    (t, s) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.textContent?.trim().startsWith(t));
      if (el) el.click();
      return !!el;
    },
    text,
    sel,
  );
  if (!ok) throw new Error(`no element with text ${text}`);
}

async function cachedFlow(mobile) {
  const tag = mobile ? "mobile" : "desktop";
  const { browser, page, logs } = await launch({ mobile });
  try {
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="sessions"] [role="radio"]');
    const n = await page.$$eval('[data-testid="sessions"] [role="radio"]', (els) => els.length);
    check(`${tag}: session picker lists sessions`, n >= 3, `${n} sessions`);
    await shot(page, `${OUT}/${tag}-1-pick.png`);

    for (const [ref, name] of [
      ["sample:session-bad", "bad"],
      ["sample:session-good", "good"],
      ["fixture:sample", "sample"],
    ]) {
      await page.goto(`${BASE}/report?session=${encodeURIComponent(ref)}&view=result`, { waitUntil: "networkidle0" });
      await page.waitForSelector('[data-testid="total"]', { timeout: 15000 });
      const total = await page.$eval('[data-testid="total"]', (e) => Number(e.textContent));
      const head = await page.$eval('[data-testid="headline"]', (e) => e.textContent);
      check(`${tag}: ${name} result renders`, Number.isFinite(total), `total ${total} · ${head}`);
      results.push({ name: `score:${name}`, ok: true, info: String(total) });
      if (name !== "sample" && mobile) await shot(page, `${OUT}/${tag}-2-result-${name}.png`, { fullPage: true });
    }
    // sample: full flow result → detail tabs
    await shot(page, `${OUT}/${tag}-2-result-sample.png`, { fullPage: true });
    const o1 = await overflow(page);
    check(`${tag}: result no horizontal overflow`, !o1.scroll && !o1.bad.length, JSON.stringify(o1.bad));
    const dl = await page.$eval('[data-testid="download"]', (a) => a.getAttribute("href"));
    const dlRes = await fetch(`${BASE}${dl}`);
    check(`${tag}: JSON download link`, dlRes.ok && /attachment/.test(dlRes.headers.get("content-disposition") ?? ""), dl);

    await clickText(page, "상세 피드백 보기");
    await page.waitForSelector('[data-testid="qa-panel"]');
    const qaText = await page.$eval('[data-testid="qa-panel"]', (e) => e.textContent);
    check(`${tag}: QA card has score badge + 이렇게 답해 보세요`, /\d+점/.test(qaText) && qaText.includes("이렇게 답해 보세요"));
    await shot(page, `${OUT}/${tag}-3-qa1.png`, { fullPage: true });
    await page.click('[data-testid="next-q"]');
    await sleep(300);
    const contra = await page.$('[data-testid="contradictions"]');
    const q2 = await page.$eval('[data-testid="qa-panel"]', (e) => e.textContent);
    check(`${tag}: Q2 (118 vs 142원) shows contradictions with page chips`, !!contra && /p\.\d+/.test(q2), q2.match(/(발표자료|제안자료) p\.\d+/g)?.slice(0, 4).join(", "));
    await shot(page, `${OUT}/${tag}-4-qa2.png`, { fullPage: true });

    await clickText(page, "발표 분석", '[role="tab"]');
    await page.waitForSelector('[data-testid="speech-panel"]');
    const cov = await page.$$eval('[data-testid="coverage"] li', (els) => els.length);
    check(`${tag}: speech tab metrics + slide coverage`, cov === 12, `${cov} slides`);
    await shot(page, `${OUT}/${tag}-5-speech.png`, { fullPage: true });

    await clickText(page, "자료 품질", '[role="tab"]');
    await page.waitForSelector('[data-testid="materials-panel"]');
    const mism = await page.$$eval('[data-testid="consistency"] li', (els) => els.filter((e) => e.textContent.includes("불일치")).length);
    check(`${tag}: materials tab consistency mismatches`, mism >= 2, `${mism} mismatches`);
    await shot(page, `${OUT}/${tag}-6-materials.png`, { fullPage: true });
    const o2 = await overflow(page);
    check(`${tag}: detail no horizontal overflow`, !o2.scroll && !o2.bad.length, JSON.stringify(o2.bad));

    const errs = logs.filter((l) => /^\[(error|pageerror)\]/.test(l) && !/favicon/.test(l));
    check(`${tag}: no console errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
  }
}

async function liveFlow() {
  const { browser, page, logs } = await launch({ mobile: true });
  try {
    const base = JSON.parse(readFileSync("fixtures/sample-session.json", "utf8"));
    const s = { ...base, id: `ui-paste-${Date.now().toString(36)}`, qa: base.qa.slice(1, 3), transcript: base.transcript.slice(0, 30) };
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle0" });
    await clickText(page, "SessionRecord JSON 붙여넣기");
    await page.$eval('textarea[aria-label="SessionRecord JSON"]', (el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, JSON.stringify(s));
    await clickText(page, "세션 추가");
    await page.waitForFunction((id) => [...document.querySelectorAll('[role="radio"][aria-checked="true"]')].some((e) => e.textContent.includes(id)), { timeout: 10000 }, s.id);
    check("live: pasted session saved + selected", true, s.id);
    const t0 = Date.now();
    await page.click('[data-testid="generate"]');
    await page.waitForSelector('[data-testid="progress"]');
    await sleep(9000);
    const running = await page.$$eval('[data-status="running"]', (e) => e.length);
    const done = await page.$$eval('[data-status="done"]', (e) => e.length);
    check("live: per-section progress shown", running + done > 0, `running ${running}, done ${done}`);
    await shot(page, `${OUT}/mobile-7-progress.png`, { fullPage: true });
    await page.waitForSelector('[data-testid="total"]', { timeout: 240000 });
    const total = await page.$eval('[data-testid="total"]', (e) => e.textContent);
    check("live: report generated in UI", true, `total ${total} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await shot(page, `${OUT}/mobile-8-live-result.png`, { fullPage: true });
    const errs = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
    check("live: no console errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
  }
}

await cachedFlow(true);
await cachedFlow(false);
if (live) await liveFlow();
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.filter((r) => r.ok && !r.name.startsWith("score:")).length}/${results.filter((r) => !r.name.startsWith("score:")).length} PASS`);
process.exit(fails.length ? 1 : 0);
