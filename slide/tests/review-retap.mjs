// review:slide — investigates blank slide after re-tapping the active sample / fullPage screenshot
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = ".verify/slide/review";
const { browser, page, logs } = await launch({ mobile: true });
await page.goto(`${BASE}/slide`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-sample="presentation"]');
await page.tap('[data-sample="presentation"]');
await page.waitForSelector('[data-state="ready"]');
await sleep(1200);
for (let i = 0; i < 5; i++) { await page.keyboard.press("ArrowRight"); await sleep(250); }
await sleep(800);
const st = () => page.evaluate(() => ({ hosts: [...document.querySelectorAll("[data-page-host]")].map((h) => `${h.dataset.pageHost}:${h.dataset.renderState}:${h.querySelectorAll("canvas").length}`).join(","), info: document.querySelector("[data-file-name]")?.nextElementSibling?.textContent, metric: document.querySelector('[data-metric="page"]').textContent }));
console.log("before retap", await st());
await page.tap('[data-sample="presentation"]');
await sleep(1500);
console.log("after retap", await st());
await shot(page, `${OUT}/r13-retap-viewport.png`);
console.log("after viewport shot", await st());
await shot(page, `${OUT}/r14-fullpage.png`, { fullPage: true });
console.log("after fullpage shot", await st());
await sleep(1500);
console.log("1.5s later", await st());
console.log(logs.filter((l) => /warn|error/i.test(l)));
await browser.close();
