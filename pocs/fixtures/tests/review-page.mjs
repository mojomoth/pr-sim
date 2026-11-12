import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/fixtures/review";
for (const mobile of [true, false]) {
  const { browser, page, logs } = await launch({ mobile });
  const t0 = Date.now();
  const resp = await page.goto(`${BASE}/fixtures`, { waitUntil: "networkidle0" });
  const ms = Date.now() - t0;
  const info = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector("h1")?.textContent,
    audio: document.querySelectorAll("audio").length,
    links: [...document.querySelectorAll("a")].map(a => a.getAttribute("href")),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    mainBg: getComputedStyle(document.querySelector("main")).backgroundColor,
    textLen: document.body.innerText.length,
  }));
  const linkStatus = [];
  for (const l of info.links) { if (!l || l.startsWith("http")) continue; const r = await fetch(BASE + l, { method: "HEAD" }); linkStatus.push(`${l}:${r.status}`); }
  // audio playback
  const play = await page.evaluate(async () => {
    const out = [];
    for (const a of document.querySelectorAll("audio")) {
      a.muted = true;
      try { await a.play(); await new Promise(r => setTimeout(r, 1500)); out.push({ src: a.currentSrc.split("/").pop(), t: +a.currentTime.toFixed(2), dur: +a.duration.toFixed(2), err: a.error?.code ?? null }); a.pause(); }
      catch (e) { out.push({ src: a.src, err: String(e) }); }
    }
    return out;
  });
  await shot(page, `${OUT}/page-${mobile ? "mobile" : "desktop"}.png`, { fullPage: false });
  await shot(page, `${OUT}/page-${mobile ? "mobile" : "desktop"}-full.png`, { fullPage: true });
  console.log(mobile ? "MOBILE" : "DESKTOP", resp.status(), ms + "ms", JSON.stringify(info), "\n links", linkStatus.join(" "), "\n play", JSON.stringify(play), "\n logs", JSON.stringify(logs));
  await browser.close();
}
