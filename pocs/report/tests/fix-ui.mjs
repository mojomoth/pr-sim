// Fix-round UI checks for /report (own headless Chrome). Screenshots → .verify/report/fix/
//   node report/tests/fix-ui.mjs
// 1) "다시 생성" while the judge model fails (request rewritten to provider:"claude", which is out of quota) →
//    Korean error card, no score shown, the cached report (and its 점수 badge) survives.
// 2) a report generated through the Gemini fallback renders (mobile + desktop).
// 3) pasting a session with an existing id but different content → saved separately, note shown.
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import { readFileSync } from "node:fs";

const OUT = ".verify/report/fix";
const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`);
};

async function failFlow(mobile) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().endsWith("/api/report/generate") && req.method() === "POST") {
        const body = JSON.parse(req.postData() ?? "{}");
        req.continue({ postData: JSON.stringify({ ...body, provider: "claude" }) });
      } else req.continue();
    });
    await page.goto(`${BASE}/report?session=${encodeURIComponent("fixture:sample")}`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="regenerate"]');
    const before = await page.evaluate(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent ?? "");
    await page.click('[data-testid="regenerate"]');
    await page.waitForSelector('[data-testid="error"]', { timeout: 60000 });
    const err = await page.$eval('[data-testid="error"]', (e) => e.textContent ?? "");
    check(`${tag}: failed 다시 생성 shows Korean error`, /리포트를 완성하지 못했어요/.test(err) && !/[A-Za-z]{6,} [A-Za-z]{4,}/.test(err.replace(/Claude|OpenAI|Gemini|API/g, "")), err.slice(0, 90));
    check(`${tag}: no score card on failure`, (await page.$('[data-testid="total"]')) === null);
    await shot(page, `${OUT}/${tag}-fail-regenerate.png`, { fullPage: true });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "세션 목록")?.click());
    await page.waitForSelector('[data-testid="open"]', { timeout: 10000 });
    const after = await page.evaluate(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent ?? "");
    check(`${tag}: cached 70점 badge survives`, /70점/.test(after) && /70점/.test(before), after.slice(0, 40));
    await page.click('[data-testid="open"]');
    await page.waitForSelector('[data-testid="total"]', { timeout: 15000 });
    const total = await page.$eval('[data-testid="total"]', (e) => Number(e.textContent));
    check(`${tag}: old report still opens`, total === 70, `total ${total}`);
    const errs = logs.filter((l) => l.type === "error" && !/Failed to load resource/.test(l.text));
    check(`${tag}: no console errors`, errs.length === 0, errs.map((l) => l.text).join(" | ").slice(0, 200));
  } finally {
    await browser.close();
  }
}

async function newReport(mobile) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  try {
    await page.goto(`${BASE}/report?session=${encodeURIComponent("question:qs_mwdlwe06tr6dc")}&view=result`, { waitUntil: "networkidle0" });
    await page.waitForSelector('[data-testid="total"]', { timeout: 15000 });
    const total = await page.$eval('[data-testid="total"]', (e) => Number(e.textContent));
    const subs = await page.$$eval('[data-testid^="sub-"]', (els) => els.length);
    check(`${tag}: gemini-fallback report renders`, Number.isFinite(total) && subs === 4, `total ${total}, ${subs} sub-scores`);
    await shot(page, `${OUT}/${tag}-gemini-result.png`, { fullPage: true });
    const errs = logs.filter((l) => l.type === "error");
    check(`${tag}: no console errors`, errs.length === 0, errs.map((l) => l.text).join(" | ").slice(0, 200));
  } finally {
    await browser.close();
  }
}

async function pasteFlow() {
  const { browser, page } = await launch({ mobile: true });
  try {
    const s = JSON.parse(readFileSync("fixtures/sample-session.json", "utf8"));
    s.id = "fix-dup-test";
    s.qa[0].answer = `UI에서 바꾼 답변 ${Date.now()}`;
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle0" });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("JSON 붙여넣기"))?.click());
    await page.waitForSelector('textarea[aria-label="SessionRecord JSON"]');
    await page.$eval('textarea[aria-label="SessionRecord JSON"]', (el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, JSON.stringify(s));
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "세션 추가")?.click());
    await page.waitForSelector('[data-testid="paste-note"]', { timeout: 10000 });
    const note = await page.$eval('[data-testid="paste-note"]', (e) => e.textContent ?? "");
    check("m: same-id paste saved separately with note", /덮어쓰지 않고/.test(note), note);
    await shot(page, `${OUT}/m-paste-note.png`);
  } finally {
    await browser.close();
  }
}

await failFlow(true);
await failFlow(false);
await newReport(true);
await newReport(false);
await pasteFlow();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
