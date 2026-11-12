// Visual check of src/components without owning a route: SSR'd static markup (render.cjs, next/* stubbed)
// is injected into #app-scroll of the live app so the real globals.css/Tailwind build styles it.
// Run: node app/.verify/g2/SHELL/gallery.mjs <dir-with-gallery-*.html>
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { readFileSync } from "node:fs";
const dir = process.argv[2], OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/SHELL";
for (const mode of ["desktop", "mobile"]) {
  const { browser, page, logs } = await launch({ mobile: mode === "mobile" });
  for (const k of ["a", "b"]) {
    await page.goto("http://localhost:3000/", { waitUntil: "networkidle0" });
    await page.evaluate((html) => { document.getElementById("app-scroll").innerHTML = html; }, readFileSync(`${dir}/gallery-${k}.html`, "utf8"));
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, `${OUT}/gallery-${k}-${mode}-top.png`);
    const info = await page.evaluate(() => {
      const s = document.getElementById("app-scroll"); s.scrollTo(0, 99999);
      const imgs = [...s.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0, filter: getComputedStyle(i).filter }));
      const overflowX = s.scrollWidth > s.clientWidth;
      return { imgs, overflowX };
    });
    await new Promise((r) => setTimeout(r, 400));
    await shot(page, `${OUT}/gallery-${k}-${mode}-bottom.png`);
    console.log(mode, k, JSON.stringify(info));
  }
  console.log(mode, "logs", logs.filter((l) => !l.includes("React DevTools") && !l.includes("[HMR]")));
  await browser.close();
}
