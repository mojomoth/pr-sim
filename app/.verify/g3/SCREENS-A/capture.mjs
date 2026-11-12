// SCREENS-A G3 fixer capture: setup judge rows (390 / 360 / desktop frame) + history.
// Seeds IndexedDB from G2 seed data (no API calls).   node capture.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { seed as seedC } from "../../g2/SCREENS-C/seed.mjs";

const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/SCREENS-A";
const BASE = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seedB = JSON.parse(readFileSync(`${OUT}/seed.json`, "utf8")); // built by ./seed-build.mjs (copy of g2/SCREENS-B)
const report = JSON.parse(readFileSync(`${G2}/SCREENS-C/session-with-report.json`, "utf8"));

async function seedRaw(page, session, blobs) {
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("pr-sim", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" });
        if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  }, session, blobs);
}

const rowProbe = (page) => page.evaluate(() => {
  const ul = document.querySelector('[aria-label="심사위원 목록"]');
  const rows = [...ul.children].map((li) => {
    const r = li.getBoundingClientRect();
    const over = [...li.querySelectorAll("*")].filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.right > r.right + 0.5 || b.left < r.left - 0.5); }).length;
    const texts = [...li.querySelectorAll("p")].map((p) => ({ text: p.textContent, clipped: p.scrollWidth > p.clientWidth }));
    const chips = [...li.querySelectorAll("[role=radio]")].map((b) => {
      const x = b.getBoundingClientRect();
      return { t: b.textContent, w: Math.round(x.width), h: Math.round(x.height), top: Math.round(x.top), hitH: getComputedStyle(b, "::before").height };
    });
    const x = li.querySelector("button[aria-label$='삭제']")?.getBoundingClientRect();
    const g = li.querySelector("[role=radiogroup]");
    const b = g.querySelector("button");
    const cs = getComputedStyle(b);
    const style = { wrap: getComputedStyle(g).flexWrap, gap: getComputedStyle(g).gap, pad: cs.padding, fs: cs.fontSize, rowParts: [...g.parentElement.children].map((c) => Math.round(c.getBoundingClientRect().width)) };
    return { h: Math.round(r.height), w: Math.round(r.width), overflowEls: over, texts, chips, style, close: x && { w: Math.round(x.width), h: Math.round(x.height) } };
  });
  const s = document.getElementById("app-scroll");
  const hint = [...document.querySelectorAll("p")].find((p) => p.textContent.includes("추가할 수 있어요"));
  return { rows, pageH: s?.scrollHeight, overflowX: s ? s.scrollWidth - s.clientWidth : null, hintLines: hint ? Math.round(hint.getBoundingClientRect().height / 18) : null, hintText: hint?.textContent };
});

const out = {};
const VPS = [
  ["390", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ["360", { width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ["desktop", { width: 1440, height: 900 }],
];
for (const [name, vp] of VPS) {
  const { browser, page, logs } = await launch({ mobile: true });
  await page.setViewport(vp);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  const setup = {
    ...seedB.session,
    id: "s_g3a_setup",
    status: "setup",
    setup: { ...seedB.session.setup, situation: "친환경 패키징 사업 제안\n투자 심사위원을 설득하는 발표", presentationMinutes: 5, qaMinutes: 3 },
    docs: { presentation: seedB.session.docs.presentation },
  };
  await seedRaw(page, setup, seedB.blobs);
  await page.goto(`${BASE}/setup?s=s_g3a_setup`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.querySelectorAll("li img").length >= 3, { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  await shot(page, `${OUT}/02-setup-${name}.png`);
  out[name] = await rowProbe(page);
  await page.evaluate(() => document.getElementById("judges-h")?.scrollIntoView({ block: "start" }));
  await sleep(400);
  await shot(page, `${OUT}/02-setup-${name}-judges.png`);
  if (name === "390") {
    await page.setViewport({ ...vp, height: Math.min(out[name].pageH + 2, 6000) });
    await sleep(600);
    await shot(page, `${OUT}/02-setup-390-full.png`);
    await page.setViewport(vp);
    await sleep(300);
    // persona change still works with the compact chips (tap 공격적 on row 1)
    await page.evaluate(() => document.getElementById("judges-h")?.scrollIntoView({ block: "start" }));
    const checked = () => page.evaluate(() => document.querySelector('[aria-label="심사위원 목록"] > li [aria-checked=true]').textContent);
    const before = await checked();
    const radios = await page.$$('[aria-label="심사위원 목록"] > li:first-child [role=radio]');
    await radios[2].tap();
    await sleep(500);
    out.personaTap = { before, after: await checked() };
    await shot(page, `${OUT}/02-setup-390-persona-changed.png`);
    await seedC(page, report);
    await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" });
    await sleep(1200);
    await shot(page, `${OUT}/07-history-390.png`);
  }
  out[name].logs = logs.filter((l) => /error|warn/i.test(l));
  await browser.close();
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
