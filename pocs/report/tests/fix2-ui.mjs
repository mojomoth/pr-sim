// Fix-round 2 UI checks for /report (own headless Chrome). Screenshots → .verify/report/fix2/
//   node report/tests/fix2-ui.mjs
// 1) no horizontal overflow on any report view (mobile 390 + desktop 1280) — BAD 발표 분석 was 520px wide
// 2) Korean headlines never break inside a word (keep-all)
// 3) lite-fallback reports show a visible warning; gpt-5.5 reports do not; picker warns when only lite models are up
// 4) malformed paste → Korean-only issue lines (no raw zod English)
// 5) failed generation → back to 세션 목록 clears the error
// 6) back during generation → a late `done` never switches the screen; without back it does
// No provider quota is spent: generation requests are either forced to the out-of-quota Claude path or answered by
// request interception with a cached report.
import { launch, shot, BASE } from "../../scripts/browser.mjs";

const OUT = ".verify/report/fix2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`);
};
const consoleErrors = (logs) => logs.filter((l) => /^\[(error|pageerror)\]/.test(l) && !/Failed to load resource|ERR_ABORTED|aborted/i.test(l));

const REPORTS = [
  ["sample:session-bad", "bad"],
  ["sample:session-good", "good"],
  ["fixture:sample", "sample"],
  ["question:qs_mwdlj84y1bhef", "lite"],
];

async function overflowOf(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const bad = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const rc = rg.getBoundingClientRect();
      if (rc.width && rc.right > W + 1) bad.push(`${Math.round(rc.right)}px: ${n.textContent.slice(0, 50)}`);
    }
    return { W, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 4) };
  });
}

/** Line breaks inside a Korean word: consecutive non-space chars rendered on different lines. */
async function midWordBreaks(page, sel) {
  return page.$eval(sel, (el) => {
    const t = el.firstChild;
    if (!t || t.nodeType !== 3) return [];
    const s = t.textContent;
    const top = (i) => {
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + 1);
      return Math.round(r.getBoundingClientRect().top);
    };
    const out = [];
    for (let i = 0; i + 1 < s.length; i++) if (/\S/.test(s[i]) && /\S/.test(s[i + 1]) && top(i + 1) > top(i) + 4) out.push(`${s.slice(Math.max(0, i - 3), i + 1)}|${s.slice(i + 1, i + 4)}`);
    return out;
  });
}

async function views(mobile) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  try {
    for (const [ref, name] of REPORTS) {
      const u = (q) => `${BASE}/report?session=${encodeURIComponent(ref)}&${q}`;
      await page.goto(u("view=result"), { waitUntil: "networkidle0" });
      await page.waitForSelector('[data-testid="total"]', { timeout: 15000 });
      const o = await overflowOf(page);
      check(`${tag} ${name} result: no horizontal overflow`, o.sw <= o.W, `sw ${o.sw} / W ${o.W} ${o.bad.join(" | ")}`);
      const br = await midWordBreaks(page, '[data-testid="headline"]');
      const hl = await page.$eval('[data-testid="headline"]', (e) => e.textContent);
      check(`${tag} ${name} headline: no mid-word break`, br.length === 0, `"${hl}" ${br.join(", ")}`);
      const lite = (await page.$('[data-testid="lite-notice"]')) !== null;
      check(`${tag} ${name} lite notice ${name === "lite" ? "shown" : "absent"}`, lite === (name === "lite"));
      if (name === "lite" || (name === "bad" && mobile)) await shot(page, `${OUT}/${tag}-${name}-result.png`, { fullPage: name === "lite" });

      for (const tab of ["qa", "speech", "materials"]) {
        await page.goto(u(`view=detail&tab=${tab}`), { waitUntil: "networkidle0" });
        await page.waitForSelector(`[data-testid="${tab === "qa" ? "qa-panel" : tab === "speech" ? "speech-panel" : "materials-panel"}"]`, { timeout: 15000 });
        let worst = await overflowOf(page);
        if (tab === "qa") {
          // walk every question card
          for (let k = 0; k < 6; k++) {
            const next = await page.$('[data-testid="next-q"]:not([disabled])');
            if (!next) break;
            await next.click();
            await sleep(150);
            const o2 = await overflowOf(page);
            if (o2.sw > worst.sw) worst = o2;
          }
        }
        check(`${tag} ${name} ${tab}: no horizontal overflow`, worst.sw <= worst.W, `sw ${worst.sw} / W ${worst.W} ${worst.bad.join(" | ")}`);
        if (tab === "speech" && name === "bad") {
          const ni = await page.$('[data-testid="number-issues"]');
          if (ni) {
            await ni.evaluate((e) => e.scrollIntoView({ block: "start" }));
            await sleep(200);
          }
          await shot(page, `${OUT}/${tag}-bad-speech-number-issues.png`);
        }
        if (tab === "speech" && name === "good") {
          const labels = await page.$$eval('[data-testid="number-issues"] [data-matches-doc]', (els) => els.map((e) => e.textContent ?? ""));
          const head = await page.$eval('[data-testid="number-issues"] p', (e) => e.textContent ?? "").catch(() => "");
          check(`${tag} good speech: proposal-matching figures labelled 감점 없음`, labels.length === 2 && labels.every((t) => /자료끼리 달라요 · 제안자료 수치와 일치 · 감점 없음/.test(t)) && /달라요 0$/.test(head.trim()), `${labels.length} labelled, head "${head}"`);
          const ni = await page.$('[data-testid="number-issues"]');
          if (ni) {
            await ni.evaluate((e) => e.scrollIntoView({ block: "start" }));
            await sleep(200);
          }
          await shot(page, `${OUT}/${tag}-good-speech-number-issues.png`);
        }
        if (name === "lite" && tab === "qa") check(`${tag} lite detail: notice shown`, (await page.$('[data-testid="lite-notice"]')) !== null);
      }
    }
    const errs = consoleErrors(logs);
    check(`${tag} views: no console errors`, errs.length === 0, errs.join(" | ").slice(0, 200));
  } finally {
    await browser.close();
  }
}

async function pickerAndPaste() {
  const { browser, page, logs } = await launch({ mobile: true });
  try {
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle0" });
    const health = await (await fetch(`${BASE}/api/report/health`)).json();
    const up = health.targets.filter((t) => !t.down);
    const liteOnly = up.length > 0 && up.every((t) => /lite/i.test(t.model));
    await sleep(300);
    const warn = await page.$('[data-testid="lite-warning"]');
    check(`picker lite warning matches /api/report/health (liteOnly=${liteOnly})`, (warn !== null) === liteOnly, warn ? await warn.evaluate((e) => e.textContent.slice(0, 60)) : "none");

    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("JSON 붙여넣기"))?.click());
    await page.waitForSelector('textarea[aria-label="SessionRecord JSON"]');
    for (const [label, bad] of [
      ["id only", '{"id":"x"}'],
      ["wrong types", '{"id":"x","situation":3,"presentationMinutes":"5","qaMinutes":3,"judges":[],"transcript":[{"t":"a"}],"qa":[],"createdAt":"x"}'],
    ]) {
      await page.$eval('textarea[aria-label="SessionRecord JSON"]', (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, bad);
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "세션 추가")?.click());
      await page.waitForSelector('[data-testid="paste-error"]', { timeout: 10000 });
      await sleep(300);
      const msg = await page.$eval('[data-testid="paste-error"]', (e) => e.innerText);
      const english = /expected|received|Invalid|undefined|invalid_type/i.test(msg);
      check(`paste ${label}: Korean-only error`, !english && /SessionRecord 형식이 아니에요/.test(msg) && /·/.test(msg), msg.replace(/\n/g, " / ").slice(0, 140));
    }
    await shot(page, `${OUT}/m-paste-error.png`, { fullPage: true });
    const errs = consoleErrors(logs);
    check("picker: no console errors", errs.length === 0, errs.join(" | ").slice(0, 200));
  } finally {
    await browser.close();
  }
}

async function failThenBack() {
  const { browser, page } = await launch({ mobile: true });
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().endsWith("/api/report/generate") && req.method() === "POST") {
        const body = JSON.parse(req.postData() ?? "{}");
        req.continue({ postData: JSON.stringify({ ...body, provider: "claude" }) }); // Claude is out of quota → fast failure
      } else req.continue();
    });
    await page.goto(`${BASE}/report?session=${encodeURIComponent("fixture:sample")}`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="regenerate"]');
    await page.click('[data-testid="regenerate"]');
    await page.waitForSelector('[data-testid="error"]', { timeout: 60000 });
    await page.click('[data-testid="to-list"]');
    await page.waitForSelector('[data-testid="open"]', { timeout: 10000 });
    await sleep(300);
    const redOnPicker = await page.$$eval("p.text-error", (els) => els.map((e) => e.textContent).filter(Boolean));
    check("failed run → 세션 목록: no stale error under the picker", redOnPicker.length === 0, redOnPicker.join(" | ").slice(0, 120));
    await shot(page, `${OUT}/m-after-fail-back.png`);
  } finally {
    await browser.close();
  }
}

/** Answer /api/report/generate with a cached report after `delayMs` (simulates a long run without spending quota). */
async function delayedRun(goBack) {
  const { browser, page, logs } = await launch({ mobile: true });
  try {
    const report = await (await fetch(`${BASE}/api/report/reports/54b1989d2ccb86f8`)).json();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().endsWith("/api/report/generate") && req.method() === "POST") {
        const steps = [{ id: "speech", group: "speech", label: "발표 내용 분석", status: "running" }];
        setTimeout(() => {
          req
            .respond({
              status: 200,
              contentType: "application/x-ndjson",
              body: `${JSON.stringify({ type: "steps", steps })}\n${JSON.stringify({ type: "done", report })}\n`,
            })
            .catch(() => {}); // the page aborted the fetch (went back) → nothing to answer
        }, 3000);
      } else req.continue();
    });
    await page.goto(`${BASE}/report?session=${encodeURIComponent("sample:session-bad")}`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="regenerate"]');
    await page.click('[data-testid="regenerate"]');
    await page.waitForSelector('[data-testid="progress"]', { timeout: 5000 });
    if (goBack) {
      await sleep(500);
      await page.click('button[aria-label="뒤로 가기"]');
      await page.waitForSelector('[data-testid="sessions"]', { timeout: 5000 });
    }
    await sleep(4500);
    const onResult = (await page.$('[data-testid="total"]')) !== null;
    const onPicker = (await page.$('[data-testid="sessions"]')) !== null;
    const err = await page.$$eval("p.text-error", (els) => els.map((e) => e.textContent).filter(Boolean));
    if (goBack) check("back during generation: late `done` does not switch to 종합 결과", !onResult && onPicker && err.length === 0, `result=${onResult} picker=${onPicker} err=${err.length}`);
    else check("no back: `done` still opens 종합 결과", onResult, `result=${onResult}`);
    const errs = consoleErrors(logs);
    check(`delayed run (${goBack ? "back" : "stay"}): no console errors`, errs.length === 0, errs.join(" | ").slice(0, 200));
  } finally {
    await browser.close();
  }
}

await views(true);
await views(false);
await pickerAndPaste();
await failThenBack();
await delayedRun(true);
await delayedRun(false);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
