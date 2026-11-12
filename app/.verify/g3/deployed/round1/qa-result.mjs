// Deployed URL, real APIs (OpenAI credits exhausted → judges/wiki unavailable): seed the G2 post-presentation session
// (3 judges friendly/strict/aggressive with G2-generated faces, wiki ready, 11 STT sentences) into IndexedDB, then
// /qa (questions, TTS, live STT answer, follow-up) → /result (report timing, page + utterance citations, feedback tab)
// → /history (reload persists, reopen without new /api/report) → fresh profile (per-browser storage).
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire("/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs");
const puppeteer = require("puppeteer-core");
const BASE = "https://pr-sim-lake.vercel.app";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/deployed/round1/qa";
const V = "/Users/jyl/work/study/pr-sim/app/.verify";
const seedB = JSON.parse(readFileSync(`${V}/g3/recheck1/visual/seed.json`, "utf8"));
const after = JSON.parse(readFileSync(`${V}/g2/SCREENS-B/session-after-present.json`, "utf8"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const timings = [];
const lines = []; const L = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ` + a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); console.log(s.slice(0, 700)); lines.push(s); };
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); L(`${ok ? "PASS" : "FAIL"} ${name}`, detail ?? ""); };
const { mkdirSync } = await import("node:fs"); mkdirSync(OUT, { recursive: true });
const PROFILE = mkdtempSync(join(tmpdir(), "prsim-dep-"));
async function launch(profile, wav) {
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--no-first-run", "--no-default-browser-check", "--disable-features=AudioServiceSandbox"];
  if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, userDataDir: profile, protocolTimeout: 600_000 });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const logs = []; const net = []; const starts = new Map();
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("request", (r) => { if (r.url().includes("/api/")) starts.set(r, Date.now()); });
  page.on("response", (r) => { if (r.url().includes("/api/") || r.status() >= 400) { const h = r.headers(); net.push({ t: Date.now(), url: r.url().replace(BASE, ""), status: r.status(), provider: h["x-provider"], model: h["x-model"], vercelError: h["x-vercel-error"] }); } });
  page.on("requestfinished", (r) => { const s = starts.get(r); if (s) timings.push({ url: r.url().replace(BASE, ""), status: r.response()?.status(), ms: Date.now() - s }); });
  page.on("requestfailed", (r) => { const s = starts.get(r); if (s) timings.push({ url: r.url().replace(BASE, ""), failed: r.failure()?.errorText, ms: Date.now() - s }); });
  await page.evaluateOnNewDocument(() => { window.__audio = []; const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { const rec = { at: Date.now() }; window.__audio.push(rec); const p = play.apply(this, arguments); p?.catch?.((e) => (rec.err = String(e))); return p; }; });
  return { browser, page, logs, net };
}
const text = (page) => page.evaluate(() => document.body.innerText);
const click = (page, t) => page.evaluate((t) => { const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.includes(t) && !x.disabled && x.offsetParent !== null); b?.click(); return !!b; }, t);
const idb = (page, id) => page.evaluate(async (id) => { const db = await new Promise((res, rej) => { const r = indexedDB.open("pr-sim"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); const rec = await new Promise((res) => { const s = db.transaction("sessions").objectStore("sessions"); const q = id ? s.get(id) : s.getAll(); q.onsuccess = () => res(q.result); }); db.close(); return rec; }, id);
const sid = "s_dep1_" + Date.now().toString(36);
const { browser, page, logs, net } = await launch(PROFILE, "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio/answer-ko-16k.wav");
try {
  await page.goto(BASE + "/history", { waitUntil: "networkidle2" });
  check("https: secure context + mediaDevices", await page.evaluate(() => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia), null);
  await page.evaluate(async (session, blobs) => {
    const db = await new Promise((res) => { const r = indexedDB.open("pr-sim"); r.onupgradeneeded = () => { r.result.createObjectStore("sessions", { keyPath: "id" }); r.result.createObjectStore("blobs"); }; r.onsuccess = () => res(r.result); });
    const tx = db.transaction(["sessions", "blobs"], "readwrite"); tx.objectStore("sessions").put(session);
    for (const [k, v] of Object.entries(blobs)) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0))], { type: v.type }), k);
    await new Promise((res) => (tx.oncomplete = res)); db.close();
  }, { ...after, id: sid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, seedB.blobs);
  L("seeded", sid);
  const tq = Date.now();
  await page.goto(`${BASE}/qa?s=${sid}`, { waitUntil: "networkidle2" });
  const ready = await page.waitForFunction(() => /질문이 준비됐어요|질문을 준비하지 못했어요/.test(document.body.innerText), { timeout: 300_000, polling: 1000 }).then(() => page.evaluate(() => document.body.innerText.includes("질문이 준비됐어요")), () => false);
  const q = (await idb(page, sid)).questions;
  check("qa: questions generated on deployed", ready && q?.main?.length > 0, { sec: Math.round((Date.now() - tq) / 1000), main: q?.main?.length, reserve: q?.reserve?.length });
  const imgs = await page.$$eval("img", (a) => a.filter((i) => i.src.startsWith("blob:") && i.naturalWidth > 0).map((i) => ({ w: i.naturalWidth, filter: getComputedStyle(i).filter, opacity: getComputedStyle(i).opacity })));
  check("qa: judge faces render in color (no filter)", imgs.length >= 1 && imgs.every((i) => i.filter === "none" && +i.opacity > 0.9), imgs);
  await page.screenshot({ path: `${OUT}/01-qa-ready.png` });
  if (ready) {
    await click(page, "질의응답 시작");
    const t0 = Date.now(); let answered = 0; let sawFollow = false;
    while (Date.now() - t0 < 150_000) {
      const st = await page.evaluate(() => ({ ended: /질의응답 시간이 끝났어요|준비한 질문이 모두 끝났어요/.test(document.body.innerText), can: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("답변 완료") && !b.disabled), follow: /꼬리 ?질문|추가 질문|이어서 묻/.test(document.body.innerText) }));
      sawFollow ||= st.follow;
      if (st.ended) break;
      if (st.can) {
        await page.waitForFunction(() => { const a = [...document.querySelectorAll("p")].find((e) => e.textContent.startsWith("내 답변"))?.parentElement?.innerText ?? ""; return a.replace(/내 답변|음성 인식 중|연결 중|·|답변을 말씀해 주세요…/g, "").trim().length > 40 || /끝났어요/.test(document.body.innerText); }, { timeout: 25_000, polling: 500 }).catch(() => {});
        await sleep(1500);
        await page.screenshot({ path: `${OUT}/02-qa-answer-${answered + 1}.png` });
        if (await click(page, "답변 완료")) answered++;
        await sleep(1500);
        await page.screenshot({ path: `${OUT}/03-qa-after-${answered}.png` });
      }
      await sleep(700);
    }
    const audio = await page.evaluate(() => window.__audio);
    const ttsNet = net.filter((n) => n.url.startsWith("/api/tts"));
    check("qa: TTS question spoken OR on-screen text fallback", audio.some((a) => !a.err) || ttsNet.some((n) => n.status === 503), { plays: audio, tts: ttsNet.map((n) => [n.status, n.provider]) });
    await page.screenshot({ path: `${OUT}/04-qa-end.png` });
    const rec = await idb(page, sid);
    check("qa: STT answers saved", rec.qa.length > 0 && rec.qa.some((x) => x.answer.trim()), { qa: rec.qa.length, answers: rec.qa.map((x) => x.answer.length), qaSentences: rec.transcript.filter((s) => s.phase === "qa").length, status: rec.status });
    const fu = net.filter((n) => n.url.startsWith("/api/questions/followup"));
    check("qa: follow-up endpoint called and answered", fu.length > 0 && fu.every((n) => n.status === 200), { followup: fu.map((n) => n.status), decisions: rec.qa.map((x) => x.decision), followupItems: rec.qa.filter((x) => x.followup).length, sawFollowText: sawFollow });
    L("qa end:", (await text(page)).slice(0, 300));
    await click(page, "결과 보기");
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 20_000 });
    const tr = Date.now();
    await page.waitForFunction(() => !/결과를 정리하고 있어요/.test(document.body.innerText), { timeout: 600_000, polling: 2000 }).catch(() => {});
    const reportSec = Math.round((Date.now() - tr) / 1000);
    const recR = await idb(page, sid);
    check("result: report generated and stored", !!recR.report, { reportSec, provider: recR.report?.provider ?? recR.report?.meta?.provider, net: net.filter((n) => n.url.startsWith("/api/report")) });
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/05-result-summary.png` });
    await page.screenshot({ path: `${OUT}/05b-result-summary-full.png`, fullPage: true });
    const cites = await page.evaluate(() => [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).filter((l) => /쪽 보기|발화 보기|답변 원문 보기/.test(l)));
    L("citation buttons on summary:", cites.length, cites.slice(0, 8));
    const openCite = async (re, name) => {
      const h = await page.evaluateHandle((re) => [...document.querySelectorAll("button[aria-label]")].find((b) => new RegExp(re).test(b.getAttribute("aria-label")) && b.checkVisibility()), re);
      const el = h.asElement(); if (!el) return null;
      const label = await el.evaluate((b) => (b.scrollIntoView({ block: "center" }), b.getAttribute("aria-label")));
      await el.click();
      const opened = await page.waitForFunction(() => [...document.querySelectorAll("[role=dialog]")].some((d) => d.checkVisibility()), { timeout: 10_000 }).then(() => true, () => false);
      await sleep(2500);
      const dlg = await page.evaluate(() => { const d = [...document.querySelectorAll("[role=dialog]")].find((d) => d.checkVisibility()); return { text: d?.innerText.slice(0, 200), canvas: [...(d?.querySelectorAll("canvas, img") ?? [])].map((c) => c.width || c.naturalWidth) }; });
      await page.screenshot({ path: `${OUT}/${name}.png` });
      await page.keyboard.press("Escape"); await sleep(600);
      return { label, opened, dlg };
    };
    const c1 = await openCite("쪽 보기", "06-cite-page");
    check("result: page citation opens the slide/page sheet", c1?.opened, c1);
    const c2 = await openCite("발화 보기|답변 원문 보기", "07-cite-utterance");
    let c2b = c2;
    await (await page.$("a[href*='tab=feedback']"))?.click();
    await page.waitForFunction(() => location.search.includes("tab=feedback"), { timeout: 15_000 }).catch(() => {});
    await sleep(2000);
    await page.screenshot({ path: `${OUT}/08-result-feedback.png` });
    await page.screenshot({ path: `${OUT}/08b-result-feedback-full.png`, fullPage: true });
    if (!c2?.opened) c2b = await openCite("발화 보기|답변 원문 보기", "09-feedback-cite-utterance");
    check("result: utterance citation opens the transcript sheet", c2b?.opened, c2b);
    const c3 = await openCite("쪽 보기", "09b-feedback-cite-page");
    L("feedback page cite", c3);
    await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" });
    await page.reload({ waitUntil: "networkidle2" }); await sleep(1500);
    check("history: session listed after reload", await page.evaluate((sid) => !!document.querySelector(`a[href="/result?s=${sid}"]`), sid));
    await page.screenshot({ path: `${OUT}/10-history.png` });
    const before = net.filter((n) => n.url.startsWith("/api/report")).length;
    await (await page.$(`a[href="/result?s=${sid}"]`))?.click();
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 15_000 }).catch(() => {});
    await sleep(3000);
    check("history: reopen shows stored report, no new /api/report", net.filter((n) => n.url.startsWith("/api/report")).length === before && /\d+\s*\n?\/ 100/.test(await text(page)));
    await page.screenshot({ path: `${OUT}/11-history-reopen.png` });
  }
} catch (e) { check("run finished without exceptions", false, String(e?.message ?? e)); await page.screenshot({ path: `${OUT}/99-error.png` }).catch(() => {}); }
finally { writeFileSync(`${OUT}/console.log`, logs.join("\n")); writeFileSync(`${OUT}/net.json`, JSON.stringify(net, null, 2)); await browser.close(); }
// Restart the same profile (browser restart) → still listed; a fresh profile → not listed (per-browser IndexedDB).
{
  const { browser, page } = await launch(PROFILE);
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" }); await sleep(1500);
  check("storage: same profile after browser restart still lists the session", await page.evaluate((sid) => !!document.querySelector(`a[href="/result?s=${sid}"]`), sid));
  await browser.close();
  const fresh = mkdtempSync(join(tmpdir(), "prsim-fresh-"));
  const b2 = await launch(fresh);
  await b2.page.goto(`${BASE}/history`, { waitUntil: "networkidle2" }); await sleep(1500);
  const r = await b2.page.evaluate((sid) => ({ listed: !!document.querySelector(`a[href*="${sid}"]`), text: document.body.innerText.slice(0, 200) }), sid);
  check("storage: another browser profile does NOT see the session (per-browser)", !r.listed, r);
  await b2.page.screenshot({ path: `${OUT}/12-history-fresh-profile.png` });
  await b2.page.goto(`${BASE}/result?s=${sid}`, { waitUntil: "networkidle2" }); await sleep(2000);
  L("fresh profile deep link:", (await text(b2.page)).slice(0, 200));
  await b2.page.screenshot({ path: `${OUT}/13-result-deeplink-fresh-profile.png` });
  await b2.browser.close(); rmSync(fresh, { recursive: true, force: true });
}
rmSync(PROFILE, { recursive: true, force: true });
writeFileSync(`${OUT}/results.json`, JSON.stringify({ sid, results, timings }, null, 2));
writeFileSync(`${OUT}/run.log`, lines.join("\n"));
L(results.filter((r) => !r.ok).length ? "FAILED " + results.filter((r) => !r.ok).length : "ALL PASS", results.length);
