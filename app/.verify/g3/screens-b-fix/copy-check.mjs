// Live copy check for /present and /qa: not-found, storage error (+ retry), exit/back dialogs, timer label.
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/screens-b-fix";
const seedB = JSON.parse(readFileSync(`${OUT}/seed.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = {};
const { browser, page } = await launch({ mobile: true, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/speech-ko-16k.wav" });
const text = () => page.evaluate(() => document.getElementById("app-screen")?.innerText ?? document.body.innerText);
const click = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.trim().includes(t) && !x.disabled); b?.click(); return !!b; }, t);
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, { ...seedB.session, id: "s_g3fixcopy", setup: { ...seedB.session.setup, presentationMinutes: 5 }, status: "presentation", resume: { phase: "presentation", remainingSec: 200 } }, seedB.blobs);
  for (const route of ["present", "qa"]) {
    await page.goto(`http://localhost:3000/${route}?s=nope`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.innerText.includes("기록을 찾을 수 없어요"), { timeout: 15000 });
    res[`${route}-missing`] = (await text()).trim();
    await shot(page, `${OUT}/${route}-missing.png`);
  }
  await page.goto("http://localhost:3000/present?s=s_g3fixcopy", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
  res.timerLabel = await page.evaluate(() => document.querySelector(".sticky")?.innerText);
  await click("이어서 발표하기"); await sleep(2500);
  await click("종료"); await sleep(800);
  res.presentExitDialog = await page.evaluate(() => document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')?.innerText);
  await shot(page, `${OUT}/present-exit-dialog.png`);
  await click("계속"); await page.keyboard.press("Escape"); await sleep(500);
  // storage error → LoadFailed with retry (not "not found")
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p2.evaluateOnNewDocument(() => {
    if (sessionStorage.getItem("__okIdb")) return;
    const orig = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...a) => { if (window.__okIdb) return orig(...a); const req = {}; setTimeout(() => req.onerror && req.onerror(new Event("error")), 0); return req; };
    window.__restoreIdb = () => { window.__okIdb = true; };
  });
  for (const route of ["present", "qa"]) {
    await p2.goto(`http://localhost:3000/${route}?s=s_g3fixcopy`, { waitUntil: "networkidle2" });
    await p2.waitForFunction(() => document.body.innerText.includes("기록을 불러오지 못했어요"), { timeout: 15000 });
    res[`${route}-storageError`] = await p2.evaluate(() => document.getElementById("app-screen")?.innerText.trim());
    await shot(p2, `${OUT}/${route}-storage-error.png`);
  }
  await p2.evaluate(() => window.__restoreIdb());
  await p2.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("다시 시도"))?.click());
  await p2.waitForFunction(() => !document.body.innerText.includes("기록을 불러오지 못했어요"), { timeout: 15000 }).then(() => (res.retryRecovered = true), () => (res.retryRecovered = false));
  await sleep(1500);
  res.afterRetry = (await p2.evaluate(() => document.getElementById("app-screen")?.innerText.trim().slice(0, 120)));
  await shot(p2, `${OUT}/qa-storage-retry-ok.png`);
} finally {
  writeFileSync(`${OUT}/copy-check.json`, JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
}
