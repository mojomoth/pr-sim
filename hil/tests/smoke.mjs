// Route smoke test: every page route on mobile 390x844 → HTTP status, console errors, horizontal overflow, screenshot.
// Run from pocs/: node hil/tests/smoke.mjs  → .verify/final/*.png + .verify/final/smoke.json
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import { writeFileSync } from "node:fs";
const ROUTES = ["/", "/devlog", "/hil", "/fixtures", "/ui", "/ui/setup", "/ui/presentation", "/ui/review", "/ui/results", "/ui/feedback",
  "/ui/history", "/ui/screens", "/stt-tts", "/wiki", "/judge", "/slide", "/slide/embed", "/question", "/report"];
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = arg ? arg.split(",") : null;
const mobile = !process.argv.includes("--desktop");
const results = [];
const { browser, page, logs } = await launch({ mobile });
for (const r of ROUTES.filter((x) => !only || only.includes(x))) {
  logs.length = 0;
  const t = Date.now();
  let status = 0;
  try {
    const res = await page.goto(BASE + r, { waitUntil: "networkidle2", timeout: 45000 });
    status = res?.status() ?? 0;
  } catch (e) { logs.push(`[goto] ${e.message}`); }
  await new Promise((s) => setTimeout(s, 1200));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => -1);
  const name = (r === "/" ? "home" : r.slice(1).replace(/\//g, "_")) + (mobile ? "" : "-desktop");
  await shot(page, `.verify/final/${name}.png`);
  const errors = logs.filter((l) => /^\[(error|pageerror|requestfailed)\]/.test(l) || l.startsWith("[goto]"));
  results.push({ route: r, status, ms: Date.now() - t, overflow, errors, warnings: logs.filter((l) => l.startsWith("[warn")).slice(0, 5) });
  console.log(`${status === 200 && !errors.length && overflow <= 0 ? "PASS" : "FAIL"} ${r} ${status} ${Date.now() - t}ms overflow=${overflow} errors=${errors.length}`);
  for (const e of errors) console.log("   ", e.slice(0, 220));
}
await browser.close();
writeFileSync(`.verify/final/smoke${mobile ? "" : "-desktop"}.json`, JSON.stringify(results, null, 1));
