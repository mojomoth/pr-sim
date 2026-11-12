// Headless check of /fixtures (mobile + desktop) and the public fixture URLs. node fixtures/tests/page.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
for (const mobile of [true, false]) {
  const { browser, page, logs } = await launch({ mobile });
  const t0 = Date.now();
  await page.goto(`${BASE}/fixtures`, { waitUntil: "networkidle0" });
  const info = await page.evaluate(() => ({ h1: document.querySelector("h1")?.textContent, audio: document.querySelectorAll("audio").length, overflowX: document.documentElement.scrollWidth > window.innerWidth, hrefs: [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")) }));
  await shot(page, `.verify/fixtures/page-${mobile ? "mobile" : "desktop"}.png`, { fullPage: !mobile });
  console.log(mobile ? "mobile" : "desktop", Date.now() - t0, "ms", JSON.stringify(info), "errors:", logs.filter((l) => /error/i.test(l)));
  await browser.close();
}
for (const p of ["/fixtures/presentation.pdf", "/fixtures/proposal.pdf", "/fixtures/audio/speech-ko-16k.wav", "/fixtures/sample-session.json", "/fixtures/presentation-script.txt", "/fixtures/audio/answer-ko.txt", "/fixtures/audio/answer-ko.wav"]) {
  const r = await fetch(BASE + p);
  console.log(p, r.status, r.headers.get("content-type"), (await r.arrayBuffer()).byteLength);
}
