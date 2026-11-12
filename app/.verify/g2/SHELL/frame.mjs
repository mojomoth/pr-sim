// SHELL device-frame check: desktop (frame) + mobile (full screen). Injects a long page and a fixed
// .app-bottom-bar into #app-scroll so the check does not depend on any screen being built.
// Run: node app/.verify/g2/SHELL/frame.mjs [path]
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = "http://localhost:3000";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/SHELL";
const path = process.argv[2] ?? "/";
const inject = () => {
  const s = document.getElementById("app-scroll");
  const probe = document.createElement("div");
  probe.id = "probe";
  probe.innerHTML = Array.from({ length: 40 }, (_, i) => `<p style="padding:12px 24px;border-bottom:1px solid #e2e2e2">probe row ${i + 1}</p>`).join("");
  const bar = document.createElement("div");
  bar.className = "app-bottom-bar";
  bar.id = "probe-bar";
  bar.style.background = "#111";
  bar.style.color = "#fff";
  bar.innerHTML = '<div style="height:56px;margin:12px 24px 0;display:flex;align-items:center;justify-content:center">fixed bottom bar</div>';
  s.append(probe, bar);
};
const measure = () => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
  const scr = document.getElementById("app-screen"), sc = document.getElementById("app-scroll"), bar = document.getElementById("probe-bar");
  const cs = getComputedStyle(document.documentElement);
  return {
    viewport: [innerWidth, innerHeight],
    frameMode: matchMedia("(min-width: 768px) and (min-height: 700px) and (hover: hover) and (pointer: fine)").matches,
    deviceScale: cs.getPropertyValue("--device-scale").trim(),
    deviceTransform: getComputedStyle(document.querySelector(".device")).transform,
    screen: r(scr), scroll: r(sc), bar: bar && r(bar),
    layoutWidth: scr.offsetWidth, layoutHeight: scr.offsetHeight, scrollClientH: sc.clientHeight, scrollH: sc.scrollHeight,
    docScrollH: document.documentElement.scrollHeight, winScrollable: document.documentElement.scrollHeight > innerHeight,
    title: document.title, lang: document.documentElement.lang,
    themeColor: document.querySelector('meta[name="theme-color"]')?.content,
    icons: [...document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')].map((l) => `${l.rel} ${l.getAttribute("href")}`),
    font: getComputedStyle(document.body).fontFamily.slice(0, 40),
  };
};
const results = {};
for (const mode of ["desktop", "mobile"]) {
  const { browser, page, logs } = await launch({ mobile: mode === "mobile" });
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await shot(page, `${OUT}/${mode}-page.png`);
  await page.evaluate(inject);
  const before = await page.evaluate(measure);
  await page.evaluate(() => document.getElementById("app-scroll").scrollTo(0, 99999));
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(measure);
  await shot(page, `${OUT}/${mode}-probe-scrolled.png`);
  results[mode] = { before, barAfterScroll: after.bar, scrollTop: await page.evaluate(() => document.getElementById("app-scroll").scrollTop), logs: logs.filter((l) => !l.includes("[HMR]") && !l.includes("Download the React DevTools")) };
  await browser.close();
}
console.log(JSON.stringify(results, null, 1));
