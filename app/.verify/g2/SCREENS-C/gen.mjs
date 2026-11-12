// 1st run: seed a session without report, open /result, let it call the real /api/report, save evidence.
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { buildSession, seed, readSession, savedReportPath } from "./seed.mjs";
const dir = new URL(".", import.meta.url).pathname;
const { browser, page, logs } = await launch({ mobile: true });
try {
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  const rec = buildSession();
  await seed(page, rec);
  const net = [];
  page.on("response", (r) => r.url().includes("/api/") && net.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  const t0 = Date.now();
  await page.goto(`http://localhost:3000/result?s=${rec.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("결과를 정리하고 있어요"), { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 20000));
  await shot(page, `${dir}01-progress.png`);
  for (let i = 0; ; i++) {
    const st = await page.evaluate(() => (document.querySelector("[data-testid=total-score]") ? "done" : document.body.innerText.includes("결과를 만들지 못했어요") ? "error" : ""));
    if (st) break;
    if (i % 15 === 0) await shot(page, `${dir}01-progress-${String(i).padStart(3, "0")}.png`);
    if (Date.now() - t0 > 600000) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log("finished in", Math.round((Date.now() - t0) / 1000), "s");
  await shot(page, `${dir}02-after-generate.png`);
  const saved = await readSession(page, rec.id);
  if (saved?.report) writeFileSync(savedReportPath, JSON.stringify(saved));
  console.log("status", saved?.status, "report?", !!saved?.report, "total", saved?.report?.overall?.total, "provider", saved?.report?.meta?.provider);
  console.log(net.join("\n"));
} finally {
  writeFileSync(`${dir}gen-console.log`, logs.join("\n"));
  await browser.close();
}
