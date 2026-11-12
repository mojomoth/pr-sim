// Deployed checks that need no AI calls: HTTPS camera/mic permission (prompt → denied → granted) on /present at 390×844,
// and the 1440×900 desktop iPhone-mockup frame. Reuses the main flow's Chrome profile (PROFILE arg) and clones its
// session into a fresh "setup" copy so /present opens (no /api/wiki, /api/judges calls).
// Run: node perm-desktop.mjs <profileDir> <sessionId>
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const puppeteer = createRequire("/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs")("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "https://pr-sim-lake.vercel.app";
const OUT = join(import.meta.dirname, "perm-desktop");
mkdirSync(OUT, { recursive: true });
const [profile, sid] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${JSON.stringify(detail).slice(0, 400)}`); };
const shot = (page, n) => page.screenshot({ path: join(OUT, n + ".png") });
const lines = (page, re) => page.evaluate((src) => document.body.innerText.split("\n").filter((l) => new RegExp(src).test(l)), re);

// NOTE: no --use-fake-ui-for-media-stream → Chrome's real permission logic decides.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ["--use-fake-device-for-media-stream", "--no-first-run", "--no-default-browser-check"] });
const ctx = browser.defaultBrowserContext();
const page = (await browser.pages())[0] ?? (await browser.newPage());
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
const apiCalls = [];
page.on("request", (r) => r.url().includes("/api/") && apiCalls.push(r.url().replace(BASE, "")));
await page.evaluateOnNewDocument(() => {
  window.__gum = [];
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = (c) => { const rec = { at: Date.now(), video: !!c?.video, audio: !!c?.audio }; window.__gum.push(rec); return orig(c).then((s) => ((rec.ok = true), s), (e) => ((rec.err = e?.name), Promise.reject(e))); };
});
await page.goto(BASE + "/history", { waitUntil: "networkidle2" });
const copy = await page.evaluate(async (sid) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("pr-sim"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = (mode) => db.transaction("sessions", mode).objectStore("sessions");
  const rec = await new Promise((res) => { const q = tx("readonly").get(sid); q.onsuccess = () => res(q.result); });
  if (!rec) return null;
  const id = sid + "p";
  const now = new Date().toISOString();
  const c = { ...rec, id, status: "setup", transcript: [], qa: [], questions: undefined, report: undefined, resume: undefined, finishedAt: undefined, createdAt: now, updatedAt: now };
  await new Promise((res, rej) => { const q = tx("readwrite").put(c); q.onsuccess = res; q.onerror = () => rej(q.error); });
  db.close();
  return id;
}, sid);
check("perm: cloned session for /present", !!copy, copy);
const secure = await page.evaluate(() => ({ isSecureContext, protocol: location.protocol, hasGUM: !!navigator.mediaDevices?.getUserMedia }));
check("perm: HTTPS secure context with getUserMedia", secure.isSecureContext && secure.protocol === "https:" && secure.hasGUM, secure);
const perms = () => page.evaluate(async () => ({ camera: (await navigator.permissions.query({ name: "camera" })).state, mic: (await navigator.permissions.query({ name: "microphone" })).state }));

// 1) prompt state (never decided)
await ctx.clearPermissionOverrides();
const before = await perms();
await page.goto(`${BASE}/present?s=${copy}`, { waitUntil: "networkidle2" });
await page.waitForSelector("[data-slide-viewer][data-state=ready]", { timeout: 30_000 }).catch(() => {});
await sleep(4000);
const gum1 = await page.evaluate(() => window.__gum);
const txt1 = await lines(page, "카메라|마이크|권한");
check("perm prompt: state was 'prompt' and the page requested the camera (permission prompt raised over HTTPS)", before.camera === "prompt" && gum1.some((g) => g.video), { before, gum: gum1, ui: txt1, after: await perms() });
await shot(page, "perm-1-prompt");

// 2) denied
await browser._connection.send("Browser.setPermission", { permission: { name: "camera" }, setting: "denied", origin: BASE });
await browser._connection.send("Browser.setPermission", { permission: { name: "microphone" }, setting: "denied", origin: BASE });
await page.reload({ waitUntil: "networkidle2" });
await page.waitForSelector("[data-slide-viewer][data-state=ready]", { timeout: 30_000 }).catch(() => {});
await sleep(3000);
const deniedUi = await lines(page, "권한");
check("perm denied: clear permission notice before start", deniedUi.some((l) => /카메라 권한/.test(l)) && deniedUi.some((l) => /권한 필요|권한이/.test(l)), { perms: await perms(), ui: deniedUi, gum: await page.evaluate(() => window.__gum) });
await shot(page, "perm-2-denied-ready");
const startBtn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("발표 시작")));
if (startBtn.asElement()) { await startBtn.asElement().click(); await sleep(4000); }
const deniedLive = await lines(page, "권한|마이크|카메라");
check("perm denied: after 발표 시작 the mic/camera denial is stated (not '켜짐')", deniedLive.some((l) => /마이크 권한/.test(l)) && !deniedLive.some((l) => /마이크 켜짐|카메라 켜짐/.test(l)), deniedLive);
await shot(page, "perm-3-denied-live");

// 3) granted
await ctx.overridePermissions(BASE, ["camera", "microphone"]);
await page.goto(`${BASE}/present?s=${copy}`, { waitUntil: "networkidle2" });
await page.waitForSelector("[data-slide-viewer][data-state=ready]", { timeout: 30_000 }).catch(() => {});
await sleep(3000);
const grantedUi = await lines(page, "카메라|마이크");
const video = await page.evaluate(() => [...document.querySelectorAll("video")].map((v) => ({ w: v.videoWidth, playing: !v.paused })));
check("perm granted: camera preview live, toggles read 켜짐", video.some((v) => v.w > 0 && v.playing) && grantedUi.some((l) => /카메라 켜짐/.test(l)), { perms: await perms(), video, ui: grantedUi });
await shot(page, "perm-4-granted");
await page.goto(BASE + "/history", { waitUntil: "networkidle2" }); // leave /present (stops media)

// 4) desktop 1440×900 mockup
const dpage = await browser.newPage();
await dpage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
for (const [name, path] of [["landing", "/"], ["history", "/history"], ["result", `/result?s=${sid}`], ["present", `/present?s=${copy}`]]) {
  await dpage.goto(BASE + path, { waitUntil: "networkidle2" });
  await sleep(2500);
  const m = await dpage.evaluate(() => {
    const dev = document.querySelector(".device"), scr = document.getElementById("app-screen");
    const bg = dev ? getComputedStyle(dev, "::after").backgroundImage : null;
    const r = scr?.getBoundingClientRect(), d = dev?.getBoundingClientRect();
    const img = new Image(); img.src = "/device/mockup-iphone.png";
    return { bg, screen: r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, device: d && { x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.width), h: Math.round(d.height) }, docScrollW: document.documentElement.scrollWidth };
  });
  const loaded = await dpage.evaluate(() => fetch("/device/mockup-iphone.png").then((r) => r.status + " " + r.headers.get("content-type")));
  const centered = m.device && Math.abs(m.device.x + m.device.w / 2 - 720) < 4 && m.device.y >= 0 && m.device.y + m.device.h <= 900 + 1;
  check(`desktop 1440×900 ${name}: iPhone mockup frame drawn, centered, fits height, no horizontal scroll`, /mockup-iphone\.png/.test(m.bg ?? "") && centered && m.docScrollW <= 1440 && loaded.startsWith("200"), { ...m, png: loaded });
  await dpage.screenshot({ path: join(OUT, `desktop-${name}.png`) });
}
writeFileSync(join(OUT, "results.json"), JSON.stringify({ results, apiCalls, logs }, null, 2));
await browser.close();
const f = results.filter((r) => !r.ok).length;
console.log(f ? `FAILED ${f}/${results.length}` : `ALL ${results.length} PASSED`);
