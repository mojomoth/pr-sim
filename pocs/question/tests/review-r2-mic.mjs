// Review r2: answer by voice (fake mic = fixtures/audio/answer-ko-16k.wav → Live STT) after replaying a run (mobile).
import { resolve } from "node:path";
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/question/review/r2-mobile-mic";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: resolve("fixtures/audio/answer-ko-16k.wav") });
const api = [];
page.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
await page.evaluateOnNewDocument(() => {
  const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => { console.log("GUM", JSON.stringify(c)); const s = await g(c); try { const ac = new AudioContext(); const an = ac.createAnalyser(); ac.createMediaStreamSource(s).connect(an); const buf = new Float32Array(2048); let k = 0; const iv = setInterval(() => { an.getFloatTimeDomainData(buf); let r = 0; for (const v of buf) r += v * v; console.log("RMS", ac.state, Math.sqrt(r / buf.length).toFixed(4)); if (++k > 8) clearInterval(iv); }, 2000); } catch (e) { console.log("RMS err", e.message); } console.log("GUM ok", s.getAudioTracks().map((t) => t.label + ":" + t.readyState).join()); return s; };
  const WS = window.WebSocket; let n = 0, m = 0;
  window.WebSocket = function (u, p) { const w = new WS(u, p); console.log("WS open", String(u).slice(0, 60)); w.addEventListener("message", async (ev) => { m++; const d = typeof ev.data === "string" ? ev.data : await ev.data.text?.(); console.log("WS msg", m, String(d).replace(/\s+/g, "").slice(0, 160)); }); const os = w.send.bind(w); w.send = (d) => { if (++n % 50 === 1) console.log("WS send", n); return os(d); }; w.addEventListener("close", (e) => console.log("WS close", e.code, e.reason)); return w; };
  window.WebSocket.prototype = WS.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
});
await page.goto(`${BASE}/question`, { waitUntil: "networkidle2" });
await page.evaluate(() => { const d = document.querySelector('[data-testid="replay"]'); d.open = true; });
await page.waitForFunction(() => document.querySelectorAll("#replay-run option").length > 1, { timeout: 10000 });
await page.select("#replay-run", process.argv[2] ?? "r_mwdmu6jz0jvkr");
await page.click('[data-testid="replay-load"]');
await page.waitForSelector('[data-testid="start-qa"]', { timeout: 10000 });
if (process.env.VOICE_OFF) await page.evaluate(() => { document.querySelectorAll("input[type=checkbox]").forEach((c) => { if (c.parentElement?.textContent?.includes("음성으로 질문 읽기") && c.checked) c.click(); }); });
await page.click('[data-testid="start-qa"]');
await sleep(Number(process.env.MIC_DELAY ?? 800));
await page.click('button[aria-label="마이크로 답변"]');
const t0 = Date.now();
let txt = "";
for (let i = 0; i < 25; i++) { await sleep(1000); txt = await page.$eval('textarea[aria-label="답변"]', (e) => e.value); if (txt.length > 60 && i > 15) break; }
console.log("heard after", Date.now() - t0, "ms:", txt.slice(0, 300));
await shot(page, `${OUT}/mic-listening.png`);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("답변 완료"))?.click());
await page.waitForFunction(() => !document.body.innerText.includes("심사위원이 답변을 검토 중") && document.querySelector('[data-testid="last-assessment"]'), { timeout: 90000 }).catch(() => {});
console.log("result:", await page.evaluate(() => document.querySelector('[data-testid="last-assessment"]')?.textContent));
await shot(page, `${OUT}/mic-answered.png`);
console.log(api.join("\n"));
console.log("errors", logs.filter((l) => /^\[(error|pageerror)\]/.test(l))); console.log("LOGS", logs.filter((l) => /RMS|GUM|setupComplete|voiceActivity|Transcription|serverContent/.test(l)).slice(0, 40).join("\n"));
await browser.close();
