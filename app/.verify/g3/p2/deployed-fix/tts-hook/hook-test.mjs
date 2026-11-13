// Unit-checks the lib.mjs launch() hooks: __speech skips the silent unlock utterance, records real ones.
import { launch } from "/Users/jyl/work/study/pr-sim/app/tests/e2e/lib.mjs";
const { browser, page } = await launch();
await page.goto((process.env.BASE_URL ?? "http://localhost:3217") + "/", { waitUntil: "networkidle2" });
const r = await page.evaluate(async () => {
  const z = new SpeechSynthesisUtterance(" "); z.volume = 0; speechSynthesis.speak(z);
  speechSynthesis.speak(new SpeechSynthesisUtterance("질문 하나 드리겠습니다."));
  await new Promise((r) => setTimeout(r, 1500));
  return { speech: window.__speech, audio: window.__audio };
});
console.log(JSON.stringify(r));
await browser.close();
process.exit(r.speech.length === 1 && r.speech[0].chars > 0 ? 0 : 1);
