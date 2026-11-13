import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const { browser, page } = await launch({ mobile: true });
const out = {};
for (const n of ["3 / 6", "10 / 12"]) for (const w of [320, 360]) {
  await page.setViewport({ width: w, height: 700, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto("http://localhost:3000/history", { waitUntil: "networkidle0" });
  out[`${n}@${w}`] = await page.evaluate((n) => {
    const host = document.querySelector("main") ?? document.body;
    const wrap = document.createElement("div");
    wrap.style.cssText = `width:${innerWidth - 32}px;margin-left:16px`;
    wrap.innerHTML = `<div class="relative"><div class="relative rounded-[20px] px-5 py-4 bg-surface text-ink"><p class="mb-1 text-[13px] leading-5 text-secondary">심사위원 질문 · <span class="tabular">${n}</span> · 기기 음성</p><div class="text-[17px] leading-[26px] font-medium"><span class="text-[18px] font-semibold leading-[27px]">투자 회수 시점을 2028년으로 잡은 근거는?</span></div></div><button type="button" class="absolute right-2 top-1 inline-flex h-11 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-secondary"><svg width="14" height="14"></svg> 질문 다시 듣기</button></div>`;
    host.prepend(wrap);
    const p = wrap.querySelector("p"), b = wrap.querySelector("button");
    const r = document.createRange(); r.selectNodeContents(p);
    const r2 = document.createRange(); r2.selectNodeContents(b);
    return { labelRight: Math.round(r.getBoundingClientRect().right), btnTextLeft: Math.round(r2.getBoundingClientRect().left), overlapPx: Math.round(r.getBoundingClientRect().right - r2.getBoundingClientRect().left) };
  }, n);
  await page.screenshot({ path: `replay-${w}-${n.replace(/\W/g, "")}.png`, clip: { x: 0, y: 0, width: w, height: 200 } });
}
console.log(JSON.stringify(out));
await browser.close();
