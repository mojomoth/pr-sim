// node touch-probe.mjs [BASE] — effective hit areas via document.elementFromPoint at 390x844 on /setup and /history.
// /api/judges is aborted (no paid image generation): rows fall back to stand-in judges, layout unchanged.
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = process.argv[2] ?? "http://localhost:3000", OUT = import.meta.dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const measure = (page, targets) => page.evaluate(async (targets) => {
  const res = [];
  for (const [name, sel, text] of targets) {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && (!text || e.textContent.includes(text)));
    for (const [i, el] of els.entries()) {
      el.scrollIntoView({ block: "center" }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hits = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
      const reach = (dx, dy, x0, y0) => { let n = 0; while (n < 30 && hits(x0 + dx * (n + 0.5), y0 + dy * (n + 0.5))) n++; return n; };
      const ext = { top: reach(0, -1, cx, r.top), bottom: reach(0, 1, cx, r.bottom), left: reach(-1, 0, r.left, cy), right: reach(1, 0, r.right, cy) };
      const out8 = { top: hits(cx, r.top - 8), bottom: hits(cx, r.bottom + 8), left: hits(r.left - 8, cy), right: hits(r.right + 8, cy) };
      const who = (x, y) => { const h = document.elementFromPoint(x, y); return h ? `${h.tagName.toLowerCase()}${h.getAttribute("aria-label") ? "[" + h.getAttribute("aria-label") + "]" : ""}:${(h.textContent || "").trim().slice(0, 12)}` : null; };
      res.push({ name: `${name}#${i}`, label: el.getAttribute("aria-label") ?? el.textContent.trim().slice(0, 20), drawn: `${+r.width.toFixed(1)}x${+r.height.toFixed(1)}`,
        effective: `${+(r.width + ext.left + ext.right).toFixed(1)}x${+(r.height + ext.top + ext.bottom).toFixed(1)}`, ext, out8,
        stolenBy: { top: hits(cx, r.top - ext.top - 1) ? null : who(cx, r.top - ext.top - 1), bottom: who(cx, r.bottom + ext.bottom + 0.5), left: who(r.left - ext.left - 0.5, cy), right: who(r.right + ext.right + 0.5, cy) } });
    }
  }
  return res;
}, targets);
const { browser, page } = await launch({ mobile: true });
await page.setRequestInterception(true);
page.on("request", (q) => (q.url().includes("/api/judges") ? q.abort() : q.continue()));
const out = {};
await page.goto(BASE + "/setup", { waitUntil: "networkidle2" }); await sleep(2500);
await page.evaluate(() => document.querySelector("#app-scroll").scrollTo(0, 0)); await shot(page, `${OUT}/touch-setup-top.png`);
out.setup = await measure(page, [
  ["stepper", 'button[aria-label$="줄이기"], button[aria-label$="늘리기"]'],
  ["sample", "button", "샘플 자료로 해보기"],
  ["toneChip", '[role=radiogroup][aria-label$="성향"] button'],
  ["judgeDelete", 'button[aria-label$="심사위원 삭제"]'],
  ["add", "button", "추가"],
]);
await shot(page, `${OUT}/touch-setup-judges.png`);
await page.goto(BASE + "/history", { waitUntil: "networkidle2" }); await sleep(1500);
out.history = await measure(page, [["filterChip", '[role=radiogroup][aria-label="기록 필터"] button']]);
await shot(page, `${OUT}/touch-history.png`);
await browser.close();
for (const [p, rows] of Object.entries(out)) for (const r of rows) console.log(p.padEnd(8), r.name.padEnd(14), String(r.label).slice(0, 22).padEnd(22), "drawn", r.drawn.padEnd(10), "effective", r.effective.padEnd(10), "8px-out", JSON.stringify(r.out8), "stop", JSON.stringify(r.stolenBy));
writeFileSync(`${OUT}/touch.json`, JSON.stringify(out, null, 2));
