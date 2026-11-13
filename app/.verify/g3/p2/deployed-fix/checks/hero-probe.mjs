// node hero-probe.mjs — HEAD prod (:3311) vs fix prod (:3312): hero webp on /history (Link prefetch of /), console warnings, LCP on / at 390x844.
import { writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const OUT = import.meta.dirname, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const servers = { head: "http://localhost:3311", fix: "http://localhost:3312" };
const out = {};
for (const [tag, BASE] of Object.entries(servers)) {
  out[tag] = { history: [], lcp: { none: [], slow4g: [] } };
  // /history: does the landing hero get fetched without being used?
  for (let i = 0; i < 2; i++) {
    const { browser, page, logs } = await launch({ mobile: true });
    const reqs = []; page.on("request", (r) => r.url().includes("hero-stage") && reqs.push(r.url().replace(BASE, "")));
    await page.goto(BASE + "/history", { waitUntil: "networkidle0" }); await sleep(4000);
    out[tag].history.push({ heroRequests: reqs, warnings: logs.filter((l) => /preload/i.test(l)) });
    await browser.close();
  }
  // LCP on / (hard load), plain and under Slow-4G-ish throttling + 4x CPU
  for (const prof of ["none", "slow4g"]) for (let i = 0; i < 5; i++) {
    const { browser, page } = await launch({ mobile: true });
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (prof === "slow4g") { await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
    await page.evaluateOnNewDocument(() => { window.__lcp = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push({ t: Math.round(e.startTime), el: e.element?.tagName, url: (e.url || "").split("/").pop(), size: e.size }); }).observe({ type: "largest-contentful-paint", buffered: true }); });
    await page.goto(BASE + "/", { waitUntil: "networkidle0", timeout: 120000 }); await sleep(1500);
    const r = await page.evaluate(() => { const img = document.querySelector(".app-bleed img"), b = document.querySelector(".app-bleed"); const ir = img.getBoundingClientRect(), br = b.getBoundingClientRect();
      const nav = performance.getEntriesByType("navigation")[0]; const res = performance.getEntriesByName(new URL(img.src, location.href).href)[0];
      return { lcp: window.__lcp.at(-1), imgRect: [ir.x, ir.y, ir.width, ir.height].map(Math.round), bleedRect: [br.x, br.y, br.width, br.height].map(Math.round), heroFetchStart: res && Math.round(res.fetchStart), heroEnd: res && Math.round(res.responseEnd), ttfb: Math.round(nav.responseStart) }; });
    out[tag].lcp[prof].push(r);
    if (i === 0 && prof === "none") await shot(page, `${OUT}/hero-${tag}-landing.png`);
    await browser.close();
  }
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const [tag, v] of Object.entries(out)) {
  console.log(tag, "history:", JSON.stringify(v.history));
  for (const prof of ["none", "slow4g"]) { const rs = v.lcp[prof]; console.log(tag, prof, "LCP", rs.map((r) => r.lcp?.t).join(","), "median", med(rs.map((r) => r.lcp?.t)), "el", rs[0].lcp?.el, rs[0].lcp?.url, "heroFetchStart", rs.map((r) => r.heroFetchStart).join(","), "heroEnd", rs.map((r) => r.heroEnd).join(","), "img", rs[0].imgRect, "bleed", rs[0].bleedRect); }
}
writeFileSync(`${OUT}/hero.json`, JSON.stringify(out, null, 2));
