// Live ingest progress UI: rebuilds a wiki from the UI ("위키 다시 만들기") and screenshots the SSE-driven progress.
// node wiki/tests/progress.mjs <docId>   (real LLM calls; large doc takes ~3–5 min)
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const docId = process.argv[2];
const OUT = ".verify/wiki";
const { browser, page, logs } = await launch({ mobile: false });
page.on("dialog", (d) => d.accept());
await page.goto(`${BASE}/wiki?doc=${docId}`, { waitUntil: "networkidle0" });
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.includes("위키 다시 만들기"));
  b?.click();
  return !!b;
});
console.log("rebuild clicked", clicked);
const t0 = Date.now();
const snaps = [8, 45, 110];
for (const s of snaps) {
  while (Date.now() - t0 < s * 1000) await new Promise((r) => setTimeout(r, 500));
  const txt = await page.evaluate(() => [...document.querySelectorAll("h3")].find((h) => h.textContent === "인제스트")?.parentElement?.parentElement?.innerText ?? "");
  console.log(`--- t=${s}s\n${txt.split("\n").slice(0, 14).join(" | ")}`);
  await shot(page, `${OUT}/progress-${s}s.png`);
}
await page.waitForFunction(() => document.body.innerText.includes("완료 ·") && document.querySelector("article h2"), { timeout: 900000, polling: 2000 });
console.log("ready after", Math.round((Date.now() - t0) / 1000), "s");
await shot(page, `${OUT}/progress-done.png`);
const { page: m, browser: b2 } = await launch({ mobile: true });
await m.goto(`${BASE}/wiki?doc=${docId}`, { waitUntil: "networkidle0" });
await m.evaluate(() => [...document.querySelectorAll("h3")].find((h) => h.textContent === "인제스트")?.scrollIntoView());
await shot(m, `${OUT}/progress-mobile-done.png`);
await b2.close();
console.log("console errors:", logs.filter((l) => /^\[(error|pageerror)\]/.test(l)).length);
await browser.close();
