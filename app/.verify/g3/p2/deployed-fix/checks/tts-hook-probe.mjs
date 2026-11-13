// E2E_OUT=<this dir>/tts-hook-run node tts-hook-probe.mjs — exercises tests/e2e/lib.mjs launch() hooks in a real page.
import { launch, APP } from "/Users/jyl/work/study/pr-sim/app/tests/e2e/lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const silent = readFileSync("/Users/jyl/work/study/pr-sim/app/src/platform/web/playWav.ts", "utf8").match(/SILENT_WAV =\s*"([^"]+)"/)?.[1];
const { browser, page } = await launch();
await page.goto(APP + "/", { waitUntil: "networkidle2" });
const r = await page.evaluate(async (silent) => {
  const out = {};
  // 1) unlock path exactly as the app does it on 질의응답 시작: silent WAV play + silent utterance
  const a = new Audio(); a.src = silent; await a.play().catch(() => {}); a.pause();
  const u0 = new SpeechSynthesisUtterance(" "); u0.volume = 0; speechSynthesis.speak(u0);
  out.afterUnlock = { audio: window.__audio.length, speech: window.__speech.length };
  // 2) D22 device-voice fallback: a real utterance
  const u = new SpeechSynthesisUtterance("안녕하세요, 첫 번째 질문입니다."); u.lang = "ko-KR"; speechSynthesis.speak(u);
  await new Promise((r) => setTimeout(r, 1500));
  out.afterSpeak = { audio: window.__audio.length, speech: JSON.parse(JSON.stringify(window.__speech)) };
  const audio = window.__audio, speech = window.__speech;
  out.flowVia = [audio.length && "server-audio", speech.length && "device-voice"].filter(Boolean).join("+") || "none";
  out.speechProtoPatched = SpeechSynthesis.prototype.speak.toString().includes("__speech");
  return out;
}, silent);
console.log(JSON.stringify({ silentFound: !!silent, ...r }, null, 1));
writeFileSync(import.meta.dirname + "/tts-hook.json", JSON.stringify(r, null, 2));
await browser.close();
