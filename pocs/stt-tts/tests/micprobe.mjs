// Probe: does Chrome's fake mic actually play the WAV? (prints peak level seen by Web Audio)
import puppeteer from "puppeteer-core";
import { CHROME, BASE } from "../../scripts/browser.mjs";
const wav = process.argv[2]; const extra = process.argv.slice(3);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", `--use-file-for-fake-audio-capture=${wav}`, ...extra] });
const page = await browser.newPage();
await page.goto(`${BASE}/stt-tts`);
const r = await page.evaluate(async () => {
  const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(st).connect(an);
  const buf = new Float32Array(2048); let max = 0;
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 100)); an.getFloatTimeDomainData(buf); for (const v of buf) max = Math.max(max, Math.abs(v)); }
  return { max };
});
console.log(extra.join(" ") || "(no extra)", r);
await browser.close();
