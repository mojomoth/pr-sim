// node report/tests/review2-progress.mjs — live generation from the picker on mobile, sampling the progress view
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile: true });
await page.goto(`${BASE}/report?session=question%3Aqs_mwdlj84y1bhef`, { waitUntil: "networkidle0" });
await sleep(800);
console.log("selected", await page.evaluate(() => document.querySelector("[aria-checked=true]")?.textContent?.slice(0, 60)));
await page.click("[data-testid=generate]");
const t0 = Date.now();
const samples = [];
for (let i = 0; i < 100; i++) {
  await sleep(3000);
  const s = await page.evaluate(() => ({
    view: new URL(location.href).searchParams.get("view"),
    statuses: [...document.querySelectorAll("[data-status]")].map((e) => e.getAttribute("data-status")[0]).join(""),
    total: document.querySelector("[data-testid=total]")?.textContent,
    err: document.querySelector("[data-testid=error]")?.textContent,
  }));
  samples.push(`${Math.round((Date.now() - t0) / 1000)}s ${s.statuses} ${s.total ?? ""} ${s.err ?? ""}`);
  if (i === 3) await shot(page, ".verify/report/review/r2m-progress.png", { fullPage: true });
  if (s.total || s.err) {
    await shot(page, ".verify/report/review/r2m-progress-end.png", { fullPage: true });
    break;
  }
}
console.log(samples.join("\n"));
console.log("console", logs.filter((l) => /\[(error|pageerror)\]/.test(l)));
await browser.close();
