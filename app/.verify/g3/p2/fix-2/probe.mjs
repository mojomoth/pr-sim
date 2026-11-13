// fix-2 probe: answering state at 390×H (default 844) — hero size, answer bubble vs bottom bar, header clipping.
//   node probe.mjs <tag> [height] [desktop]
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const V2 = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-2/visual";
const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/fix-2";
const [tag = "run", hArg = "844", dev = "mobile"] = process.argv.slice(2);
const seedB = JSON.parse(readFileSync(`${V2}/seed.json`, "utf8"));
const qaDone = JSON.parse(readFileSync(`${G2}/SCREENS-B/session-after-qa-2min.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mobile = dev === "mobile";
const { browser, page } = await launch({ mobile, fakeAudioWav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav" });
if (mobile) await page.setViewport({ width: 390, height: Number(hArg), deviceScaleFactor: 2, isMobile: true, hasTouch: true });
else await page.setViewport({ width: 1440, height: 900 });
const samples = [];
const id = `s_fix2_${tag}`;
try {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim", 1); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res));
  }, { ...qaDone, id, status: "qa", qa: qaDone.qa.slice(0, 1), setup: { ...qaDone.setup, qaMinutes: 3 }, resume: { phase: "qa", remainingSec: 140 } }, seedB.blobs);
  await page.goto(`http://localhost:3000/qa?s=${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("질의응답 이어 가기"), { timeout: 20000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질의응답 이어 가기")).click());
  await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 60000 });
  const geo = () => page.evaluate(() => {
    const r = (el) => el && (({ top, bottom, height, width }) => ({ top: Math.round(top), bottom: Math.round(bottom), h: Math.round(height), w: Math.round(width) }))(el.getBoundingClientRect());
    const s = document.getElementById("app-scroll"); const bar = document.querySelector(".app-bottom-bar");
    const head = document.querySelector(".sticky");
    const img = [...document.querySelectorAll("img")].find((i) => i.alt.includes("심사위원 얼굴") && i.getBoundingClientRect().width > 0);
    const ans = [...document.querySelectorAll("div")].find((d) => d.className.includes?.("scroll-mb-[calc"));
    const a = ans?.getBoundingClientRect(); const b = bar.getBoundingClientRect(); const hd = head.getBoundingClientRect();
    return { appH: getComputedStyle(document.documentElement).getPropertyValue("--app-h"), scrollTop: Math.round(s.scrollTop), maxScroll: s.scrollHeight - s.clientHeight, head: r(head), face: r(img), faceVisibleTop: img ? Math.round(Math.max(0, hd.bottom - img.getBoundingClientRect().top)) : null, ans: r(ans), barTop: Math.round(b.top), ansHiddenPx: Math.max(0, Math.round((a?.bottom ?? 0) - b.top)), chars: ans?.innerText.length };
  });
  for (let i = 0; i < 6; i++) { await sleep(3000); samples.push({ t: (i + 1) * 3, ...(await geo()) }); }
  await shot(page, `${OUT}/04-review-${tag}.png`);
  if (process.env.DEBUG) console.log("DEBUG", JSON.stringify(await page.evaluate(() => {
    const sc = document.getElementById("app-scroll");
    const head = [...document.querySelectorAll("div")].find((d) => String(d.className).includes("sticky -top-12"));
    const ans = [...document.querySelectorAll("div")].find((d) => String(d.className).includes("scroll-mb-[calc"));
    const box = ans.querySelector("[data-clipped]") ?? ans.querySelector("div div div");
    const hero = [...document.querySelectorAll("div")].find((d) => String(d.className).includes("h-[clamp(140px"));
    const cs = (e) => getComputedStyle(e);
    return { scClientH: sc.clientHeight, scTop: sc.scrollTop, scPadB: cs(sc).scrollPaddingBottom, scPadT: cs(sc).scrollPaddingTop, headH: head.offsetHeight, headTop: cs(head).top, ansMB: cs(ans).scrollMarginBottom, heroH: hero?.offsetHeight, heroStyle: hero?.getAttribute("style"), origin: sc.getBoundingClientRect().top, heroTop: hero?.getBoundingClientRect().top, ansBottom: ans.getBoundingClientRect().bottom, boxH: box?.clientHeight, boxLH: box && cs(box).lineHeight, appH: cs(sc).height };
  })));
} catch (e) {
  console.log("FAIL", String(e).slice(0, 200), (await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => "")).replace(/\n/g, " | "));
  await shot(page, `${OUT}/99-fail-${tag}.png`).catch(() => {});
} finally {
  writeFileSync(`${OUT}/probe-${tag}.json`, JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(samples, null, 1));
  await browser.close();
}
