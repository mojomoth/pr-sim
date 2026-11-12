// Headless Chrome: TTS form → generate (cache), 3-way compare, resolved voice/style shown, no console errors.
import { launch, shot, BASE } from "./launch.mjs";
import { writeFileSync } from "node:fs";
const mobile = process.argv[2] !== "desktop";
const { browser, page, logs } = await launch({ mobile });
const out = { mobile };
const tag = mobile ? "mobile" : "desktop";
try {
  await page.goto(`${BASE}/stt-tts`, { waitUntil: "networkidle0" });
  const tts = await page.$("#tts-title");
  await tts.scrollIntoView();
  // persona: 남자 / 58 / 빡셈 (defaults) → check resolved voice text
  await page.click('[role=radiogroup][aria-label="성향"] button:nth-child(2)');
  out.resolved = await page.$eval("[data-testid=tts-resolved]", (e) => e.innerText.replace(/\n/g, " | "));
  await page.click("[data-testid=tts-generate]");
  await page.waitForSelector("[data-testid=tts-clip]", { timeout: 120000 });
  out.firstClip = await page.$eval("[data-testid=tts-clip]", (e) => e.innerText.replace(/\n/g, " | "));
  await page.click("[data-testid=tts-compare]");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=tts-clip]").length >= 4, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1500));
  out.progress = await page.$eval("[data-testid=tts-progress]", (e) => e.textContent).catch(() => null);
  out.clips = await page.$$eval("[data-testid=tts-clip]", (els) => els.map((e) => e.innerText.replace(/\n/g, " | ")));
  out.error = await page.$eval("[data-testid=tts-error]", (e) => e.textContent).catch(() => null);
  const sec = await page.$("#tts-title");
  await sec.scrollIntoView();
  await shot(page, `.verify/stt-tts/tts-${tag}.png`, { fullPage: !mobile });
  if (mobile) {
    // scroll to see clip list
    await page.evaluate(() => document.querySelector("[data-testid=tts-clip]")?.scrollIntoView({ block: "center" }));
    await shot(page, `.verify/stt-tts/tts-${tag}-clips.png`);
  }
} finally {
  out.errors = logs.filter((l) => /\[error\]|pageerror|requestfailed/i.test(l));
  writeFileSync(`.verify/stt-tts/tts-${tag}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}
