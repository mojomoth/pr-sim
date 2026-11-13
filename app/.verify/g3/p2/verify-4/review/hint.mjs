import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const { browser, page } = await launch({ mobile: true });
const out = {};
for (const w of [320, 360, 390]) {
  await page.setViewport({ width: w, height: 700, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto("http://localhost:3000/history", { waitUntil: "networkidle0" });
  out[w] = await page.evaluate(() => {
    const msgs = ["발표 상황을 입력해 주세요.", "자료를 읽고 있어요. 잠시만 기다려 주세요.", "발표 자료를 올려 주세요.", "심사위원 얼굴을 만들고 있어요. 잠시만 기다려 주세요.", "얼굴 사진이 없는 심사위원은 이름 첫 글자로 표시돼요."];
    const bar = document.querySelector(".app-bottom-bar > div") ?? document.body;
    return msgs.map((m) => { const p = document.createElement("p"); p.className = "text-center text-[13px] leading-[18px] text-secondary"; p.textContent = m; bar.append(p); const h = p.getBoundingClientRect().height; p.remove(); return [m, h]; });
  });
}
console.log(JSON.stringify(out));
await browser.close();
