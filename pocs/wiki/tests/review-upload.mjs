// Reviewer: upload a NEW pdf through the UI (mobile) and watch live progress via SSE.
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = path.resolve(".verify/wiki/review/리뷰 제안서 발췌 (30-45).pdf");
const { browser, page, logs } = await launch({ mobile: true });
page.on("response", (r) => r.status() >= 400 && logs.push(`[http ${r.status()}] ${r.url()}`));
await page.goto(`${BASE}/wiki`, { waitUntil: "networkidle0" });
await sleep(1000);
// choose kind 제안자료
await page.evaluate(() => [...document.querySelectorAll('[role=radio]')].find((b) => b.textContent === "제안자료")?.click());
const input = await page.$('input[type="file"]');
const t0 = Date.now();
await input.uploadFile(file);
const snap = async (label) => {
  const st = await page.evaluate(() => {
    const card = [...document.querySelectorAll("h3")].find((h) => h.textContent === "인제스트")?.closest("div.rounded-\\[28px\\]");
    return { card: card?.innerText?.replace(/\n+/g, " | ").slice(0, 400), scrollY, cardTop: card ? card.getBoundingClientRect().top : null };
  });
  console.log(`${label} t=${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(st));
};
await sleep(3000);
await snap("3s");
await shot(page, ".verify/wiki/review/up-01-3s-viewport.png");
await page.evaluate(() => [...document.querySelectorAll("h3")].find((h) => h.textContent === "인제스트")?.scrollIntoView());
await shot(page, ".verify/wiki/review/up-02-3s-progress.png");
let done = false;
for (let i = 0; i < 60 && !done; i++) {
  await sleep(5000);
  const s = await page.evaluate(() => [...document.querySelectorAll("h3")].find((h) => h.textContent === "인제스트")?.parentElement?.innerText ?? "");
  if (i % 3 === 0) await snap(`poll${i}`);
  if (i === 3) { await page.evaluate(() => [...document.querySelectorAll("h3")].find((h) => h.textContent === "인제스트")?.scrollIntoView()); await shot(page, ".verify/wiki/review/up-03-mid.png"); }
  done = /완료|오류/.test(s);
}
await snap("final");
await sleep(2000);
await page.evaluate(() => document.querySelector("article")?.scrollIntoView());
await shot(page, ".verify/wiki/review/up-04-done-article.png");
console.log("url", decodeURIComponent(page.url()));
console.log("docs", await page.evaluate(() => [...document.querySelectorAll("li button")].slice(0, 4).map((b) => b.innerText.replace(/\n/g, " ")).join(" ; ")));
console.log("LOGS", JSON.stringify(logs.filter((l) => !/\[(log|info|debug)\]/.test(l))));
await browser.close();
