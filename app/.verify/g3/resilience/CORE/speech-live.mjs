// Live check of src/platform/web/speech.ts in real Chrome on the dev server origin.
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const APP = "/Users/jyl/work/study/pr-sim/app";
const OUT = `${APP}/.verify/g3/resilience/CORE`;
const headless = process.argv[2] !== "headful";
const src = stripTypeScriptTypes(readFileSync(`${APP}/src/platform/web/speech.ts`, "utf8")).replace(/^import .*$/m, "");
const { browser, page, logs } = await launch({ headless });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
await page.addScriptTag({ type: "module", content: src + "\nwindow.__speech = { speak, stopSpeech, pickVoice, prosody, speechSupported };" });
await page.waitForFunction(() => window.__speech);
const result = await page.evaluate(async () => {
  const S = window.__speech;
  const log = [];
  // Record what actually reaches the engine.
  const orig = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => {
    log.push({ at: Math.round(performance.now()), text: u.text, lang: u.lang, voice: u.voice?.name ?? null, rate: u.rate, pitch: u.pitch });
    u.addEventListener("start", () => log.push({ at: Math.round(performance.now()), ev: "start", text: u.text.slice(0, 20) }));
    u.addEventListener("end", () => log.push({ at: Math.round(performance.now()), ev: "end", text: u.text.slice(0, 20) }));
    u.addEventListener("error", (e) => log.push({ at: Math.round(performance.now()), ev: "error:" + e.error }));
    return orig(u);
  };
  await new Promise((r) => setTimeout(r, 300));
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("ko")).map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
  const out = { supported: S.speechSupported(), koVoices: voices, runs: [] };
  const personas = [
    { gender: "female", age: 34, temperament: "friendly" },
    { gender: "male", age: 52, temperament: "strict" },
    { gender: "male", age: 45, temperament: "aggressive" },
  ];
  for (const p of personas) {
    const t0 = performance.now();
    const pb = S.speak("안녕하세요. 발표 잘 들었습니다. 매출 추정 근거를 설명해 주시겠어요?", p);
    let outcome;
    try { await pb.done; outcome = "resolved"; } catch (e) { outcome = "rejected: " + e.message; }
    out.runs.push({ persona: p, outcome, ms: Math.round(performance.now() - t0) });
  }
  // stop() mid-utterance: must resolve promptly and cancel the engine.
  const pb = S.speak("이 문장은 길게 읽히는 도중에 멈춰야 합니다. 두 번째 문장도 있습니다. 세 번째 문장까지 있습니다.", personas[1]);
  await new Promise((r) => setTimeout(r, 700));
  const t1 = performance.now();
  S.stopSpeech();
  await pb.done;
  out.stop = { resolvedAfterMs: Math.round(performance.now() - t1), speakingAfter: speechSynthesis.speaking };
  out.engineLog = log;
  return out;
});
await shot(page, `${OUT}/speech-live-page.png`);
result.headless = headless;
result.pageLogs = logs.filter((l) => !l.includes("[HMR]"));
writeFileSync(`${OUT}/speech-live-${headless ? "headless" : "headful"}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ supported: result.supported, koVoices: result.koVoices, runs: result.runs, stop: result.stop }, null, 1));
await browser.close();
