// Reviewer: where is the Q&A stage after tapping "질의응답 시작" (no programmatic scrolling)?
import { readFileSync } from "node:fs";
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const mode = process.argv[2] ?? "mobile";
const { browser, page } = await launch({ mobile: mode === "mobile" });
await page.setRequestInterception(true);
page.on("request", (req) => {
  if (req.url().endsWith("/api/question/generate")) return req.respond({ status: 200, contentType: "application/x-ndjson", body: readFileSync(".verify/question/review/gen1-real.ndjson", "utf8") });
  if (req.url().endsWith("/api/question/tts")) return req.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "mock tts off" }) });
  req.continue();
});
await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
await page.waitForSelector('[data-testid="judge-card"]');
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질문 생성")).click());
await page.waitForSelector('[data-testid="start-qa"]');
await new Promise((r) => setTimeout(r, 800));
// user scrolls to the button and taps it (like a real thumb)
await page.evaluate(() => document.querySelector('[data-testid="start-qa"]').scrollIntoView({ block: "center" }));
await new Promise((r) => setTimeout(r, 300));
const rect = await page.$eval('[data-testid="start-qa"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (mode === "mobile") await page.touchscreen.tap(rect.x, rect.y); else await page.mouse.click(rect.x, rect.y);
await new Promise((r) => setTimeout(r, 1200));
const pos = await page.evaluate(() => {
  const q = document.querySelector('[data-testid="qa-stage"]')?.getBoundingClientRect();
  const a = document.querySelector('textarea[aria-label="답변"]')?.getBoundingClientRect();
  return { viewportH: innerHeight, scrollY, qaStageTop: q && Math.round(q.top), qaStageBottom: q && Math.round(q.bottom), answerTop: a && Math.round(a.top) };
});
console.log(mode, JSON.stringify(pos));
await shot(page, `.verify/question/review/${mode}-after-start-qa-tap.png`);
await browser.close();
