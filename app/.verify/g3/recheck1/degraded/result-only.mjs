// Recheck: report generation outcome while OpenAI credits are exhausted (seeded G2 post-Q&A session, no report yet).
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/degraded";
const seedB = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/seed.json", "utf8"));
const qa = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-B/session-after-qa-2min.json", "utf8"));
const { browser, page, logs } = await launch({ mobile: true });
const net = []; page.on("response", (r) => { if (r.url().includes("/api/")) net.push({ url: new URL(r.url()).pathname, status: r.status() }); });
const t0 = Date.now(); let out = {};
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite"); tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, { ...qa, id: "s_rc1report", status: "done", report: undefined }, seedB.blobs);
  await page.goto("http://localhost:3000/result?s=s_rc1report", { waitUntil: "networkidle2" });
  await page.waitForFunction(() => !/결과를 정리하고 있어요/.test(document.body.innerText), { timeout: 360000, polling: 2000 });
  await new Promise((r) => setTimeout(r, 1500));
  out = { sec: Math.round((Date.now() - t0) / 1000), text: (await page.evaluate(() => document.body.innerText)).slice(0, 600), hasScore: !!(await page.$("[data-testid=total-score]")) };
  await shot(page, `${OUT}/10-result-outcome.png`);
} catch (e) { out.error = String(e); await shot(page, `${OUT}/10-result-error.png`).catch(() => {}); }
finally { out.net = net; writeFileSync(`${OUT}/result-only.json`, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out).slice(0, 1200)); await browser.close(); }
