// node probe.mjs <tag> — hero webp requests + console warnings on /history and /setup (hard load), LCP on / at 390x844.
import { writeFileSync } from "node:fs";
import { launch } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
const BASE = process.env.BASE ?? "http://localhost:3217", TAG = process.argv[2] ?? "x", OUT = import.meta.dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
for (const p of ["/history", "/setup"]) {
  const { browser, page, logs } = await launch({ mobile: true });
  const hero = [];
  page.on("request", (r) => r.url().includes("hero-stage") && hero.push({ url: r.url().replace(BASE, ""), initiator: r.initiator()?.type, prio: r.initialPriority?.() }));
  await page.goto(BASE + p, { waitUntil: "networkidle0" }); await sleep(4000);
  out[p] = { heroRequests: hero, warnings: logs.filter((l) => /preload/i.test(l)) };
  await browser.close();
}
const lcp = [];
for (let i = 0; i < 5; i++) {
  const { browser, page } = await launch({ mobile: true });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.emulateNetworkConditions?.({ download: (4 * 1024 * 1024) / 8, upload: (1 * 1024 * 1024) / 8, latency: 60 }) ;
  await page.evaluateOnNewDocument(() => { window.__lcp = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lcp.push({ t: Math.round(e.startTime), el: e.element?.tagName, url: e.url?.split("/").pop() }))).observe({ type: "largest-contentful-paint", buffered: true }); });
  await page.goto(BASE + "/", { waitUntil: "networkidle0" }); await sleep(1500);
  const r = await page.evaluate(() => ({ lcp: window.__lcp.at(-1), hero: performance.getEntriesByType("resource").filter((e) => e.name.includes("hero-stage")).map((e) => ({ start: Math.round(e.startTime), end: Math.round(e.responseEnd) })) }));
  lcp.push(r);
  await browser.close();
}
out["/ LCP 390x844 (4Mbps/60ms, cache off) x5"] = lcp;
out.lcpMedian = lcp.map((x) => x.lcp?.t).sort((a, b) => a - b)[2];
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 2));
