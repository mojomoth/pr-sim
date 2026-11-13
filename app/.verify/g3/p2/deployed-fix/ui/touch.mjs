// Independent verifier: effective hit area (elementFromPoint) of small controls at 390x844, plus a
// "every control's center hits itself" overlap check, and /history hero-preload console check. node touch.mjs
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = "http://localhost:3000", OUT = import.meta.dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const measure = (page, groups) => page.evaluate(async (groups) => {
  const sc = document.getElementById("app-scroll");
  const owner = (x, y) => { const h = document.elementFromPoint(x, y); return h?.closest("button,a,input,label,textarea,[role=slider]") ?? h; };
  const lab = (e) => (e ? (e.tagName + ":" + (e.getAttribute?.("aria-label") || e.textContent || "").trim()).slice(0, 26) : "none");
  const out = [];
  for (const [name, sel, filter] of groups) {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && (!filter || (e.getAttribute("aria-label") || e.textContent).includes(filter)));
    for (const el of els) {
      el.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 50));
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hits = (x, y) => owner(x, y) === el;
      const ext = (dx, dy) => { let d = 0; while (d < 80 && hits(cx + dx * (d + 0.5), cy + dy * (d + 0.5))) d++; return d; };
      const L = ext(-1, 0), R = ext(1, 0), U = ext(0, -1), D = ext(0, 1);
      out.push({ name, label: (el.getAttribute("aria-label") || el.textContent.trim()).slice(0, 26), drawn: `${Math.round(r.width)}x${Math.round(r.height)}`,
        hitW: L + R, hitH: U + D, centerSelf: hits(cx, cy), cornersSelf: [hits(r.left + 1, r.top + 1), hits(r.right - 1, r.top + 1), hits(r.left + 1, r.bottom - 1), hits(r.right - 1, r.bottom - 1)].every(Boolean),
        beyond: { L: lab(owner(cx - L - 1, cy)), R: lab(owner(cx + R + 1, cy)), U: lab(owner(cx, cy - U - 1)), D: lab(owner(cx, cy + D + 1)) } });
    }
  }
  sc.scrollTo({ top: 0 });
  return out;
}, groups);

// Every visible interactive element: is its own center (and drawn box corners) still owned by it (no neighbor's ::before stealing)?
const stolen = (page) => page.evaluate(async () => {
  const bad = [];
  const els = [...document.querySelectorAll("#app-screen button, #app-screen a, #app-screen input, #app-screen textarea")].filter((e) => e.getClientRects().length && !e.closest('[style*="display: none"]'));
  for (const el of els) {
    el.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 20));
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + r.height / 2], [r.right - 2, r.top + r.height / 2], [r.left + r.width / 2, r.top + 2], [r.left + r.width / 2, r.bottom - 2]];
    for (const [x, y] of pts) {
      if (y < 0 || y > innerHeight) continue;
      const h = document.elementFromPoint(x, y); const o = h?.closest("button,a,input,textarea,label");
      if (o !== el && !(o && el.contains(o)) && !(o?.tagName === "LABEL" && o.control === el) && !el.closest(".app-bottom-bar") && o?.closest(".app-bottom-bar")) continue; // covered by fixed bottom bar: expected when scrolled
      if (o !== el && !(o && el.contains(o)) && !(o?.tagName === "LABEL" && o.control === el)) bad.push({ el: (el.getAttribute("aria-label") || el.textContent).trim().slice(0, 24), at: [Math.round(x - r.left), Math.round(y - r.top)], got: o ? (o.getAttribute("aria-label") || o.textContent).trim().slice(0, 24) : h?.tagName });
    }
  }
  document.getElementById("app-scroll").scrollTo({ top: 0 });
  return bad;
});

const seed = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" }); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction(["sessions"], "readwrite");
  const now = new Date().toISOString();
  const base = { setup: { situation: "", presentationMinutes: 5, qaMinutes: 3 }, docs: {}, judges: [], transcript: [], qa: [], createdAt: now, updatedAt: now };
  tx.objectStore("sessions").put({ ...base, id: "s_verify1", status: "presentation", resume: { phase: "presentation", remainingSec: 120 }, setup: { ...base.setup, situation: "검증용 진행 중 기록" } });
  tx.objectStore("sessions").put({ ...base, id: "s_verify2", status: "qa", resume: { phase: "qa", remainingSec: 60 }, setup: { ...base.setup, situation: "검증용 두번째 기록" } });
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); db.close();
});

const res = {};
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().includes("/api/judges") ? r.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "test" } }) }) : r.continue()));
  await page.goto(BASE + "/setup", { waitUntil: "networkidle2" }); await sleep(2000);
  const judgesBefore = await page.evaluate(() => document.querySelectorAll("[aria-label='심사위원 목록'] > li").length);
  // ensure ≥2 judge rows so delete buttons render
  for (let i = 0; i < 2 && (await page.evaluate(() => document.querySelectorAll("[aria-label='심사위원 목록'] > li").length)) < 2; i++) { await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("추가"))?.click()); await sleep(800); }
  await sleep(800);
  res.judgesBefore = judgesBefore;
  res.setup = await measure(page, [
    ["stepper", "button[aria-label$='줄이기'],button[aria-label$='늘리기']"],
    ["sample link", "button", "샘플 자료로 해보기"],
    ["tone chip", "[aria-label='심사위원 목록'] [role=radiogroup] button"],
    ["judge delete", "button[aria-label$='심사위원 삭제']"],
    ["추가", "button", "추가"],
  ]);
  res.setupStolen = await stolen(page);
  await shot(page, `${OUT}/touch-390-setup.png`);
  res.setupLogs = logs.filter((l) => !/api\/judges|503/.test(l) && /^\[(error|warn|pageerror)/.test(l));

  await seed(page);
  logs.length = 0;
  await page.goto(BASE + "/history", { waitUntil: "networkidle2" }); await sleep(1500);
  res.history = await measure(page, [
    ["filter chip", "[role=radiogroup][aria-label='기록 필터'] button"],
    ["history delete", "button[aria-label$='기록 삭제']"],
  ]);
  res.historyStolen = await stolen(page);
  await shot(page, `${OUT}/touch-390-history-seeded.png`);
  await browser.close();
}

// hero preload: hard /history, hard /setup, and / -> /history client nav; wait 6s after load for Chrome's unused-preload warning
res.preload = {};
for (const [name, steps] of [["hard /history", ["/history"]], ["hard /setup", ["/setup"]], ["nav / -> /history", ["/", "tap:/history"]], ["hard / (control)", ["/"]]]) {
  const { browser, page, logs } = await launch({ mobile: true });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().includes("/api/judges") ? r.respond({ status: 503, body: "{}" }) : r.continue()));
  const hero = [];
  page.on("request", (r) => r.url().includes("hero-stage") && hero.push({ url: r.url().replace(BASE, ""), type: r.resourceType(), initiator: r.initiator()?.type, page: "" }));
  for (const s of steps) {
    if (s.startsWith("tap:")) {
      const box = await page.evaluate((h) => { const a = [...document.querySelectorAll("a")].find((x) => x.getAttribute("href") === h); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, s.slice(4));
      await page.touchscreen.tap(box.x, box.y); await page.waitForFunction((p) => location.pathname === p, {}, s.slice(4));
    } else await page.goto(BASE + s, { waitUntil: "networkidle0" });
  }
  await sleep(6000);
  const preloadLinks = await page.evaluate(() => [...document.querySelectorAll("link[rel=preload]")].map((l) => `${l.getAttribute("as")} ${l.getAttribute("href")}`));
  res.preload[name] = { heroRequests: hero, preloadLinksInHead: preloadLinks.filter((x) => /hero|landing|webp|image/.test(x)), warnings: logs.filter((l) => /preload/i.test(l)), otherWarnErr: logs.filter((l) => /^\[(warn|error|pageerror)/.test(l) && !/preload/i.test(l)) };
  await browser.close();
}

for (const r of [...res.setup, ...res.history]) console.log(r.name.padEnd(14), r.label.padEnd(26), "drawn", r.drawn.padEnd(7), "hit", `${r.hitW}x${r.hitH}`.padEnd(7), r.hitW >= 44 && r.hitH >= 44 ? "ok " : "<44", "center", r.centerSelf, "corners", r.cornersSelf, JSON.stringify(r.beyond));
console.log("judges on load", res.judgesBefore);
console.log("setup stolen", JSON.stringify(res.setupStolen));
console.log("history stolen", JSON.stringify(res.historyStolen));
console.log("setup console", JSON.stringify(res.setupLogs));
console.log("preload", JSON.stringify(res.preload, null, 1));
writeFileSync(`${OUT}/touch.json`, JSON.stringify(res, null, 2));
