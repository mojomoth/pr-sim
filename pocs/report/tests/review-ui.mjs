// Reviewer UI pass (round 1). node report/tests/review-ui.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
const OUT = ".verify/report/review";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}
async function clickTab(page, label) {
  await page.evaluate((t) => { const el=[...document.querySelectorAll("button,[role=tab]")].find(e=>e.textContent?.trim().startsWith(t)); el?.click(); }, label);
  await sleep(500);
}
for (const mobile of [true, false]) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  try {
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle0" });
    await shot(page, `${OUT}/${tag}-1-picker.png`, { fullPage: true });
    out.push([tag, "picker overflow", await overflow(page)]);
    // fixture report result
    await page.goto(`${BASE}/report?session=fixture%3Asample&view=result`, { waitUntil: "networkidle0" }); await sleep(800);
    out.push([tag, "fixture total", await page.$eval("[data-testid=total]", e => e.textContent).catch(()=>null)]);
    out.push([tag, "total font-size", await page.$eval("[data-testid=total]", e => getComputedStyle(e).fontSize).catch(()=>null)]);
    await shot(page, `${OUT}/${tag}-2-result.png`, { fullPage: true });
    out.push([tag, "result overflow", await overflow(page)]);
    await page.goto(`${BASE}/report?session=fixture%3Asample&view=detail&tab=qa`, { waitUntil: "networkidle0" }); await sleep(800);
    await page.click("[data-testid=next-q]").catch(()=>{}); await sleep(500);
    await shot(page, `${OUT}/${tag}-3-qa2.png`, { fullPage: true });
    out.push([tag, "qa overflow", await overflow(page)]);
    await clickTab(page, "발표 분석");
    await shot(page, `${OUT}/${tag}-4-speech.png`, { fullPage: true });
    out.push([tag, "speech overflow", await overflow(page)]);
    await clickTab(page, "자료 품질");
    await shot(page, `${OUT}/${tag}-5-materials.png`, { fullPage: true });
    out.push([tag, "materials overflow", await overflow(page)]);
    // degraded report (all LLM steps failed)
    await page.goto(`${BASE}/report?session=saved%3Areview-variant-1&view=result`, { waitUntil: "networkidle0" }); await sleep(800);
    out.push([tag, "degraded total", await page.$eval("[data-testid=total]", e => e.textContent).catch(()=>null)]);
    await shot(page, `${OUT}/${tag}-6-degraded.png`, { fullPage: true });
    await page.goto(`${BASE}/report?session=saved%3Areview-variant-1&view=detail&tab=qa`, { waitUntil: "networkidle0" }); await sleep(800);
    await shot(page, `${OUT}/${tag}-7-degraded-qa.png`, { fullPage: true });
    // invalid paste
    await page.goto(`${BASE}/report`, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.querySelector("button[aria-expanded]")?.click()); await sleep(300);
    await page.type("textarea", "{not json"); 
    await page.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim()==="세션 추가")?.click()); await sleep(500);
    out.push([tag, "bad paste msg", await page.evaluate(() => document.querySelector("p.text-error")?.textContent)]);
    out.push([tag, "console errors", logs.filter(l => /error|pageerror/i.test(l) && !/requestfailed.*(_rsc|hmr)/.test(l))]);
  } finally { await browser.close(); }
}
for (const r of out) console.log(JSON.stringify(r));
