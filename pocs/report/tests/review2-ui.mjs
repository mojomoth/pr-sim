// Reviewer UI pass (round 2). node report/tests/review2-ui.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/report/review";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
async function clickText(page, label) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll("button,[role=tab],a")].find((e) => e.textContent?.trim().startsWith(t));
    el?.click();
    return !!el;
  }, label);
  await sleep(600);
  return ok;
}
for (const mobile of [true, false]) {
  const tag = mobile ? "r2m" : "r2d";
  const { browser, page, logs } = await launch({ mobile });
  try {
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle0" });
    await sleep(500);
    out.push([tag, "sessions", await page.$$eval("[data-testid=sessions] button", (b) => b.length)]);
    await shot(page, `${OUT}/${tag}-1-picker.png`);
    out.push([tag, "picker overflow", await overflow(page)]);

    // BAD → result
    await page.goto(`${BASE}/report?session=sample%3Asession-bad&view=result`, { waitUntil: "networkidle0" });
    await sleep(900);
    out.push([tag, "bad total", await page.$eval("[data-testid=total]", (e) => [e.textContent, getComputedStyle(e).fontSize]).catch(() => null)]);
    await shot(page, `${OUT}/${tag}-2-bad-result.png`, { fullPage: true });
    out.push([tag, "bad result overflow", await overflow(page)]);
    out.push([tag, "result text has 잘한 점/다음 연습에서는", await page.evaluate(() => [document.body.innerText.includes("잘한 점"), document.body.innerText.includes("다음 연습에서는")])]);
    // go to detail via the UI (not deep link)
    const went = await clickText(page, "상세 피드백");
    out.push([tag, "clicked 상세", went, await page.evaluate(() => location.search)]);
    await shot(page, `${OUT}/${tag}-3-bad-qa1.png`, { fullPage: true });
    out.push([tag, "qa badge/improved", await page.evaluate(() => [document.body.innerText.match(/\d+점/g)?.slice(0, 4), !!document.querySelector("[data-testid=improved]")])]);
    await page.click("[data-testid=next-q]").catch(() => {});
    await sleep(500);
    out.push([tag, "after next", await page.evaluate(() => document.body.innerText.match(/\d \/ \d/)?.[0])]);
    await shot(page, `${OUT}/${tag}-4-bad-qa2.png`, { fullPage: true });
    await clickText(page, "발표 분석");
    await shot(page, `${OUT}/${tag}-5-bad-speech.png`, { fullPage: true });
    out.push([tag, "speech overflow", await overflow(page)]);
    out.push([tag, "speech has 503", await page.evaluate(() => document.querySelector("[data-testid=speech-panel]")?.innerText.includes("503"))]);
    await clickText(page, "자료 품질");
    await shot(page, `${OUT}/${tag}-6-bad-materials.png`, { fullPage: true });
    out.push([tag, "materials overflow", await overflow(page)]);
    // download link works
    const href = await page.evaluate(() => document.querySelector("[data-testid=download]")?.getAttribute("href"));
    out.push([tag, "download href (detail)", href]);
    await clickText(page, "종합 결과로");
    const href2 = await page.evaluate(() => document.querySelector("[data-testid=download]")?.getAttribute("href"));
    out.push([tag, "download href (result)", href2]);
    if (href2) {
      const st = await page.evaluate(async (h) => { const r = await fetch(h); const j = await r.json(); return [r.status, !!j.overall, !!j.speech.metrics, j.qa.length]; }, href2);
      out.push([tag, "download fetch", st]);
    }
    // back button → pick
    await page.click("button[aria-label='뒤로 가기']").catch(() => {});
    await sleep(500);
    out.push([tag, "back → view", await page.evaluate(() => new URL(location.href).searchParams.get("view"))]);

    // GOOD result
    await page.goto(`${BASE}/report?session=sample%3Asession-good&view=result`, { waitUntil: "networkidle0" });
    await sleep(900);
    out.push([tag, "good total", await page.$eval("[data-testid=total]", (e) => e.textContent).catch(() => null)]);
    await shot(page, `${OUT}/${tag}-7-good-result.png`, { fullPage: true });

    // fixture Q2
    await page.goto(`${BASE}/report?session=fixture%3Asample&view=detail&tab=qa`, { waitUntil: "networkidle0" });
    await sleep(900);
    await page.click("[data-testid=next-q]").catch(() => {});
    await sleep(500);
    out.push([tag, "fixture Q2 text", await page.evaluate(() => document.querySelector("[data-testid=qa-panel]")?.innerText.slice(0, 400))]);
    await shot(page, `${OUT}/${tag}-8-fixture-q2.png`, { fullPage: true });

    // invalid paste
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.querySelector("button[aria-expanded]")?.click());
    await sleep(300);
    await page.type("textarea", '{"id":"x"}');
    await clickText(page, "세션 추가");
    out.push([tag, "schema paste msg", await page.evaluate(() => document.querySelector("p.text-error")?.textContent?.slice(0, 200))]);
    await shot(page, `${OUT}/${tag}-9-bad-paste.png`);
    out.push([tag, "console", logs.filter((l) => /\[(error|pageerror)\]/.test(l))]);
  } finally {
    await browser.close();
  }
}
for (const r of out) console.log(JSON.stringify(r));
