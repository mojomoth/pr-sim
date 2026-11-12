// Deployed URL extras: desktop 1440×900 mockup render, camera/mic denied, TTS autoplay under a real user-activation policy.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire("/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs");
const puppeteer = require("puppeteer-core");
const BASE = "https://pr-sim-lake.vercel.app";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/deployed/round1/extras";
mkdirSync(OUT, { recursive: true });
const V = "/Users/jyl/work/study/pr-sim/app/.verify";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const seedB = JSON.parse(readFileSync(`${V}/g3/recheck1/visual/seed.json`, "utf8"));
const after = JSON.parse(readFileSync(`${V}/g2/SCREENS-B/session-after-present.json`, "utf8"));
const qa2 = JSON.parse(readFileSync(`${V}/g2/SCREENS-B/session-after-qa-2min.json`, "utf8"));
const withReport = JSON.parse(readFileSync(`${V}/g2/SCREENS-C/session-with-report.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail ?? "").slice(0, 500)); };
// G2 judge faces under the fixture's keys too
const blobs = { ...seedB.blobs };
const map = { friendly: "j_mwdja2lbcyyyv", strict: "j_mwdjbetg50soz", aggressive: "j_mwdja1fzc0gw5" };
for (const j of withReport.judges) { const src = map[j.temperament]; if (src) { blobs[j.imageKey] = seedB.blobs[`judge:${src}`]; blobs[j.thumbKey] = seedB.blobs[`judge:${src}:thumb`]; } }
async function launch({ args = [], viewport, wav } = {}) {
  const base = ["--use-fake-device-for-media-stream", "--no-first-run", "--no-default-browser-check", "--disable-features=AudioServiceSandbox", ...args];
  if (wav) base.push(`--use-file-for-fake-audio-capture=${wav}`);
  const profile = mkdtempSync(join(tmpdir(), "prsim-x-"));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: base, userDataDir: profile, protocolTimeout: 300_000 });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport(viewport ?? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const logs = []; page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`)); page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  return { browser, page, logs, close: async () => { await browser.close(); rmSync(profile, { recursive: true, force: true }); } };
}
async function seed(page, sessions) {
  await page.goto(BASE + "/history", { waitUntil: "networkidle2" });
  await page.evaluate(async (sessions, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim"); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    for (const s of sessions) tx.objectStore("sessions").put(s);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res)); db.close();
  }, sessions, blobs);
}
const now = new Date().toISOString();
const mode = process.argv[2] ?? "all";
// 1) desktop 1440×900
if (mode === "all" || mode === "desktop") {
  const { page, logs, close } = await launch({ args: ["--use-fake-ui-for-media-stream"], viewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });
  try {
    await seed(page, [{ ...withReport, id: "s_dep_desk", createdAt: now, updatedAt: now }, { ...after, id: "s_dep_desk_present", createdAt: now, updatedAt: now }]);
    const frame = async (name) => page.evaluate(() => {
      const imgs = [...document.querySelectorAll("*")].filter((e) => /mockup-iphone/.test(getComputedStyle(e).backgroundImage + getComputedStyle(e, "::before").backgroundImage + getComputedStyle(e, "::after").backgroundImage)).map((e) => { const r = e.getBoundingClientRect(); return { clientWidth: Math.round(r.width), clientHeight: Math.round(r.height), left: r.left }; });
      const vw = innerWidth; const sx = document.documentElement.scrollWidth;
      const all = [...document.querySelectorAll("img, video, canvas")].filter((e) => e.checkVisibility()).map((e) => ({ tag: e.tagName, filter: getComputedStyle(e).filter, w: e.clientWidth }));
      return { mockupImgs: imgs.map((i) => ({ w: i.clientWidth, h: i.clientHeight, left: Math.round(i.left) })), hOverflow: sx > vw, filters: [...new Set(all.map((a) => a.filter))] };
    });
    const pages = [["01-desktop-landing", "/"], ["02-desktop-history", "/history"], ["03-desktop-result", "/result?s=s_dep_desk"], ["04-desktop-feedback", "/result?s=s_dep_desk&tab=feedback"], ["05-desktop-present", "/present?s=s_dep_desk_present"], ["06-desktop-setup", "/setup?s=s_dep_desk_present"]];
    for (const [name, path] of pages) {
      await page.goto(BASE + path, { waitUntil: "networkidle2" }); await sleep(2500);
      const f = await frame(name);
      await page.screenshot({ path: `${OUT}/${name}.png` });
      check(`desktop 1440x900 ${path}: mockup frame, no h-overflow, no media filters`, f.mockupImgs.length > 0 && !f.hOverflow && f.filters.every((x) => x === "none"), f);
    }
    // setup via the real landing CTA
    await page.goto(BASE + "/", { waitUntil: "networkidle2" });
    await page.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent.includes("시작하기"))?.click());
    await page.waitForFunction(() => location.pathname === "/setup", { timeout: 20000 }).catch(() => {});
    await sleep(4000);
    await page.screenshot({ path: `${OUT}/07-desktop-setup-new.png` });
  } finally { writeFileSync(`${OUT}/desktop-console.log`, logs.join("\n")); await close(); }
}
// 2) camera / mic denied (no fake-ui auto-accept; CDP permission = denied)
if (mode === "all" || mode === "denied") {
  for (const which of ["camera", "microphone"]) {
    const { browser, page, logs, close } = await launch({});
    try {
      await seed(page, [{ ...after, id: "s_dep_denied", status: "presentation", transcript: [], createdAt: now, updatedAt: now }]);
      const cdp = await page.createCDPSession();
      for (const p of ["camera", "microphone"]) await cdp.send("Browser.setPermission", { origin: BASE, permission: { name: p }, setting: p === which ? "denied" : "granted" });
      await page.goto(`${BASE}/present?s=s_dep_denied`, { waitUntil: "networkidle2" });
      await sleep(3000);
      const startBtn = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("발표 시작")); b?.click(); return !!b; });
      await sleep(4000);
      const t = await page.evaluate(() => document.body.innerText);
      const msg = t.match(/[^\n]*(권한|허용|카메라|마이크)[^\n]*/g)?.slice(0, 5);
      await page.screenshot({ path: `${OUT}/10-denied-${which}.png` });
      await page.screenshot({ path: `${OUT}/10b-denied-${which}-full.png`, fullPage: true });
      check(`denied ${which}: usable message shown`, !!msg?.some((m) => /권한|허용/.test(m)), { startBtn, msg });
    } finally { writeFileSync(`${OUT}/denied-${which}-console.log`, logs.join("\n")); await close(); }
  }
}
// 3) autoplay: Chrome's real user-activation policy, /api/tts answered by a stub WAV (deployed TTS quota exhausted today)
if (mode === "all" || mode === "autoplay") {
  // 2 s, 16 kHz mono 16-bit 440 Hz tone, built here (a valid RIFF/WAVE)
  const n = 32000; const wav = Buffer.alloc(44 + n * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 16000)), 44 + i * 2);
  const { page, logs, close } = await launch({ args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=document-user-activation-required"], wav: "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav" });
  try {
    await seed(page, [{ ...after, id: "s_dep_autoplay", questions: qa2.questions, qa: [], createdAt: now, updatedAt: now }]);
    await page.evaluateOnNewDocument(() => { window.__audio = []; const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { const rec = { at: Date.now() }; window.__audio.push(rec); const p = play.apply(this, arguments); p?.then?.(() => (rec.ok = true), (e) => (rec.err = String(e))); return p; }; });
    await page.setRequestInterception(true);
    let ttsCalls = 0;
    page.on("request", (r) => { if (r.url().includes("/api/tts")) { ttsCalls++; setTimeout(() => r.respond({ status: 200, contentType: "audio/wav", headers: { "x-provider": "stub" }, body: wav }), 2500); } else r.continue(); });
    // No puppeteer evaluate on /qa before the tap: puppeteer evaluates with userGesture:true, which would grant activation.
    const cdp = await page.createCDPSession();
    const raw = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: false })).result.value;
    await page.goto(`${BASE}/qa?s=s_dep_autoplay`, { waitUntil: "networkidle2" });
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) { ready = await raw(`/질문이 준비됐어요/.test(document.body.innerText)`); if (!ready) await sleep(500); }
    const pre = await raw(`({ hasBeenActive: navigator.userActivation.hasBeenActive, isActive: navigator.userActivation.isActive, audio: window.__audio.length })`);
    // negative control: a play() attempted without any activation must be blocked by this policy
    const control = await raw(`(async () => { const a = new Audio(); a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="; try { await a.play(); return "played"; } catch (e) { return e.name; } })()`);
    await sleep(500);
    const ctl = await cdp.send("Runtime.evaluate", { expression: `(async () => { const a = new Audio(); a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="; try { await a.play(); return "played"; } catch (e) { return e.name; } })()`, awaitPromise: true, returnByValue: true, userGesture: false });
    await raw(`window.__audio.length = 0`);
    await page.screenshot({ path: `${OUT}/20-autoplay-ready.png` });
    const box = await raw(`(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("질의응답 시작") && !b.disabled); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await sleep(300);
    await page.touchscreen.tap(box.x, box.y); // trusted touch input, like a user
    await sleep(9000);
    const post = await raw(`({ hasBeenActive: navigator.userActivation.hasBeenActive })`);
    const audioRaw = await raw(`window.__audio`);
    await page.screenshot({ path: `${OUT}/21-autoplay-after-tap.png` });
    check("autoplay control: play() without a gesture is blocked by the policy", ctl.result.value === "NotAllowedError", { control: ctl.result.value });
    check("autoplay: TTS (stubbed WAV, 2.5s server delay) plays after the start tap under user-activation policy", ready && !pre.hasBeenActive && audioRaw.some((a) => a.ok) && !audioRaw.some((a) => /NotAllowed/.test(a.err ?? "")), { ready, pre, post, ttsCalls, audio: audioRaw });
  } finally { writeFileSync(`${OUT}/autoplay-console.log`, logs.join("\n")); await close(); }
}
writeFileSync(`${OUT}/results-${mode}.json`, JSON.stringify(results, null, 2));
