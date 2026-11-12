// Quick smoke: load sample deck on mobile, screenshot, print state + console.
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const sample = process.argv[2] ?? "presentation";
const { browser, page, logs } = await launch({ mobile: process.argv[3] !== "desktop" });
const t0 = Date.now();
await page.goto(`${BASE}/slide?sample=${sample}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-state="ready"]', { timeout: 30000 });
await page.waitForSelector('[data-page-host][data-render-state="done"]', { timeout: 30000 });
console.log("ready+painted in", Date.now() - t0, "ms");
await new Promise((r) => setTimeout(r, 1500));
const st = await page.evaluate(() => {
  const r = document.querySelector('[data-state]');
  return { page: r.dataset.page, total: r.dataset.total, ind: document.querySelector('[data-page-indicator]').textContent,
    metrics: Object.fromEntries([...document.querySelectorAll('[data-metric]')].map((e) => [e.dataset.metric, e.textContent])),
    hosts: [...document.querySelectorAll('[data-page-host]')].map((e) => `${e.dataset.pageHost}:${e.dataset.renderState}:${e.style.width}x${e.style.height}`),
    canvases: [...document.querySelectorAll('[data-page-host] canvas')].map((c) => `${c.width}x${c.height}`) };
});
console.log(JSON.stringify(st, null, 1));
await shot(page, `.verify/slide/smoke-${sample}-${process.argv[3] ?? "mobile"}.png`, { fullPage: true });
console.log(logs.join("\n"));
await browser.close();
