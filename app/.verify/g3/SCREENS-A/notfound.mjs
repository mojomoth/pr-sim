// /setup with an unknown id → 기록을 찾을 수 없어요 + 연습 기록으로 button.   node notfound.mjs
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/SCREENS-A";
const { browser, page, logs } = await launch({ mobile: true });
await page.goto("http://localhost:3000/setup?s=s_does_not_exist", { waitUntil: "networkidle2" });
await page.waitForFunction(() => document.body.innerText.includes("기록을 찾을 수 없어요"), { timeout: 20000 });
await shot(page, `${OUT}/02-setup-notfound.png`);
const buttons = await page.evaluate(() => [...document.querySelectorAll("[role=alert] a, [role=alert] button")].map((b) => b.textContent.trim()));
writeFileSync(`${OUT}/notfound.json`, JSON.stringify({ buttons, logs: logs.filter((l) => /error/i.test(l)) }, null, 2));
console.log(buttons);
await browser.close();
