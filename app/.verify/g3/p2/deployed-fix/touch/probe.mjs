// node probe.mjs <tag> — drawn box vs effective hit area (document.elementFromPoint) of small controls on /setup and /history at 390×844.
// /api/judges is answered with a 503 so no model is called; two judge rows are added to show the delete buttons.
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = process.env.BASE ?? "http://localhost:3217", TAG = process.argv[2] ?? "x", OUT = import.meta.dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const measure = (page, groups) => page.evaluate((groups) => {
  const hits = (el, x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
  const desc = (x, y) => { const h = document.elementFromPoint(x, y); if (!h) return "none"; const b = h.closest("button,a,input,label"); return (b ? b.tagName + ":" + (b.getAttribute("aria-label") || b.textContent.trim()).slice(0, 18) : h.tagName); };
  const out = [];
  for (const [name, sel, filter] of groups) {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && (!filter || (e.getAttribute("aria-label") || e.textContent).includes(filter)));
    for (const el of els.slice(0, 4)) {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ext = (dx, dy) => { let d = 0; while (d < 60 && hits(el, cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d; };
      const L = ext(-1, 0), R = ext(1, 0), U = ext(0, -1), D = ext(0, 1);
      out.push({ name, label: (el.getAttribute("aria-label") || el.textContent.trim()).slice(0, 24),
        drawn: `${Math.round(r.width)}×${Math.round(r.height)}`, hit: `${L + R + 1}×${U + D + 1}`, hitW: L + R + 1, hitH: U + D + 1,
        out8: { left: desc(r.left - 8, cy), right: desc(r.right + 8, cy), top: desc(cx, r.top - 8), bottom: desc(cx, r.bottom + 8) } });
    }
  }
  return out;
}, groups);
const { browser, page } = await launch({ mobile: true });
await page.setRequestInterception(true);
page.on("request", (r) => (r.url().includes("/api/judges") ? r.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "테스트용 응답이에요." } }) }) : r.continue()));
await page.goto(BASE + "/setup", { waitUntil: "networkidle2" }); await sleep(1500);
for (let i = 0; i < 2; i++) { await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("추가"))?.click()); await sleep(800); }
await sleep(1000);
const setup = await measure(page, [
  ["stepper", "button[aria-label*='줄이기'],button[aria-label*='늘리기']"],
  ["sample", "button", "샘플 자료로 해보기"],
  ["tone chip", "[role=radiogroup][aria-label*='성향'] button"],
  ["judge delete", "button[aria-label$='심사위원 삭제']"],
  ["추가", "button", "추가"],
]);
await shot(page, `${OUT}/${TAG}-setup.png`);
await page.goto(BASE + "/history", { waitUntil: "networkidle2" }); await sleep(1500);
const history = await measure(page, [["filter chip", "[role=radiogroup][aria-label='기록 필터'] button"]]);
await shot(page, `${OUT}/${TAG}-history.png`);
await browser.close();
const rows = [...setup, ...history];
for (const r of rows) console.log(r.name.padEnd(13), r.label.padEnd(24), "drawn", r.drawn.padEnd(8), "hit", r.hit.padEnd(8), r.hitW < 44 || r.hitH < 44 ? "<44" : "ok", JSON.stringify(r.out8));
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(rows, null, 2));
