// Reviewer round 1: sticky timer + portrait PDF + keyboard focus checks. Run from pocs/: node ui/tests/review-2.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";
const out = ".verify/ui/review";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timerTop = (p) =>
  p.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) => /^\d\d:\d\d$/.test(e.textContent.trim()) && e.children.length === 0);
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  });

for (const mobile of [true, false]) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  // Portrait PDF uploaded as 발표 자료
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  const inputs = await page.$$('input[type="file"]');
  await inputs[0].uploadFile(path.resolve("fixtures/proposal.pdf"));
  await sleep(3000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("발표 시작하기") && b.offsetParent)?.click());
  await page.waitForFunction(() => location.pathname === "/ui/presentation");
  await sleep(3000);
  await shot(page, `${out}/f-${tag}-portrait-top.png`);
  const stage = await page.evaluate(() => {
    const s = document.querySelector('section[aria-label="발표 자료"]');
    const r = s.getBoundingClientRect();
    return { h: Math.round(r.height), bottom: Math.round(r.bottom), vh: innerHeight, docH: document.documentElement.scrollHeight };
  });
  console.log(tag, "portrait stage", JSON.stringify(stage));
  // scroll down and check if timer still visible
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(500);
  console.log(tag, "timer top after scroll 500:", await timerTop(page));
  await shot(page, `${out}/f-${tag}-portrait-scrolled.png`);
  // keyboard: tab through presentation to check focus ring on button
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const a = document.activeElement;
    const cs = getComputedStyle(a);
    return `${a.tagName} ${a.getAttribute("aria-label") ?? a.textContent.trim().slice(0, 20)} outline=${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} shadow=${cs.boxShadow}`;
  });
  console.log(tag, "focus:", focus);
  await shot(page, `${out}/f-${tag}-focus.png`);
  console.log(tag, "errors:", logs.filter((l) => /\[error\]|pageerror/.test(l)).slice(0, 3));
  await browser.close();
}
// review screen: does timer remain visible when scrolled (mobile)
{
  const { browser, page } = await launch({ mobile: true });
  await page.goto(BASE + "/ui/review", { waitUntil: "networkidle0" });
  await sleep(6000);
  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(500);
  console.log("review timer top after scroll:", await timerTop(page));
  await shot(page, `${out}/f-m-review-scrolled.png`);
  await browser.close();
}
