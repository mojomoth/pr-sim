// Reviewer UI test (round 1). Run from pocs/: node wiki/tests/review-ui.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";

const OUT = ".verify/wiki/review";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (...a) => {
  const s = a.join(" ");
  out.push(s);
  console.log(s);
};
async function clickText(page, sel, t) {
  return page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim().includes(t));
      if (el) el.click();
      return !!el;
    },
    sel,
    t,
  );
}
async function overflow(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    return { scrollW: document.documentElement.scrollWidth, W };
  });
}

for (const mobile of [true, false]) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  page.on("response", (r) => r.status() >= 400 && logs.push(`[http ${r.status()}] ${r.url()}`));
  try {
    // 1. fresh visit without params
    await page.goto(`${BASE}/wiki`, { waitUntil: "networkidle0" });
    await sleep(1500);
    await shot(page, `${OUT}/${tag}-01-fresh.png`);
    log(tag, "fresh url:", page.url());
    log(tag, "overflow", JSON.stringify(await overflow(page)));

    // 2. sample proposal (reuse)
    const t0 = Date.now();
    log(tag, "click sample proposal:", await clickText(page, "button", "샘플: 제안자료"));
    await sleep(2500);
    log(tag, "after sample url:", page.url(), `${Date.now() - t0}ms`);
    const h1 = await page.evaluate(() => document.querySelector("article h1, article h2")?.textContent);
    log(tag, "article heading:", h1);
    await shot(page, `${OUT}/${tag}-02-proposal.png`);

    // 3. go to 주요-수치 page via list or link
    await page.evaluate(() => {
      const u = new URL(location.href);
      u.searchParams.set("page", "주요-수치");
      history.replaceState(null, "", u);
    });
    log(tag, "click 주요 수치 in list:", await clickText(page, "li button", "주요 수치"));
    await sleep(1500);
    await shot(page, `${OUT}/${tag}-03-numbers.png`, { fullPage: false });
    log(tag, "overflow numbers", JSON.stringify(await overflow(page)));
    const tableWrap = await page.evaluate(() => {
      const t = document.querySelector("article table");
      if (!t) return "no table";
      const r = t.getBoundingClientRect();
      let p = t.parentElement;
      return { w: r.width, parentOverflow: getComputedStyle(p).overflowX, vw: innerWidth };
    });
    log(tag, "table", JSON.stringify(tableWrap));

    // 4. click a wiki link in article
    const linkClicked = await page.evaluate(() => {
      const a = [...document.querySelectorAll("article a, article button")].find((e) => /overview|개요/.test(e.textContent ?? "") && !/^p\./.test(e.textContent ?? ""));
      if (a) a.click();
      return a?.textContent ?? null;
    });
    await sleep(1500);
    log(tag, "clicked link:", linkClicked, "url:", decodeURIComponent(page.url()));

    // 5. citation chip
    const cite = await page.evaluate(() => {
      const b = [...document.querySelectorAll("article button")].find((e) => /^p\.\s?\d+/.test(e.textContent?.trim() ?? ""));
      if (b) b.click();
      return b?.textContent ?? null;
    });
    await sleep(1500);
    const sheet = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent?.slice(0, 200) ?? null);
    log(tag, "cite chip:", cite, "sheet:", sheet);
    await shot(page, `${OUT}/${tag}-04-raw.png`);
    await page.keyboard.press("Escape");
    await sleep(500);
    const sheetAfterEsc = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    log(tag, "sheet open after Esc:", sheetAfterEsc);
    if (sheetAfterEsc) await clickText(page, '[role="dialog"] button', "닫기");
    await sleep(300);

    if (mobile) {
      // 6. query tab with own question
      await clickText(page, '[role="tab"]', "질의");
      await sleep(800);
      await page.type("#wiki-q", "덱과 다르게 제안서의 SOM은 얼마이고 SAM 대비 몇 %인가?");
      const tq = Date.now();
      await clickText(page, "button[type=submit]", "질의");
      await page.waitForFunction(() => ![...document.querySelectorAll("button[type=submit]")].some((b) => b.textContent?.includes("검색 중")), { timeout: 60000 });
      await sleep(500);
      log(tag, "query ms", Date.now() - tq);
      const qtext = await page.evaluate(() => document.querySelector("#wiki-q")?.closest("div.mt-5")?.innerText?.slice(0, 1500));
      log(tag, "query panel text:", qtext?.replace(/\n+/g, " | "));
      await shot(page, `${OUT}/${tag}-05-query.png`, { fullPage: true });

      // 7. click selected page chip -> goes to wiki tab; come back to query: result kept?
      const chip = await page.evaluate(() => {
        const h = [...document.querySelectorAll("h3")].find((e) => e.textContent?.includes("선택된 페이지"));
        const b = h?.parentElement?.querySelector("button");
        b?.click();
        return b?.textContent ?? null;
      });
      await sleep(1200);
      log(tag, "chip clicked:", chip, "tab now:", await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent));
      await clickText(page, '[role="tab"]', "질의");
      await sleep(800);
      log(tag, "result kept after tab switch:", await page.evaluate(() => [...document.querySelectorAll("h3")].some((e) => e.textContent?.includes("선택된 페이지"))));

      // 8. broken PDF upload
      const input = await page.$('input[type="file"]');
      await input.uploadFile(path.resolve(".verify/wiki/review/broken.pdf"));
      await sleep(5000);
      await shot(page, `${OUT}/${tag}-06-broken-upload.png`);
      const errText = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], p')].map((p) => p.textContent).filter((t) => /오류|실패|Invalid|만들지 못/.test(t ?? "")).join(" || "));
      log(tag, "broken upload messages:", errText);
      log(tag, "docs list items:", await page.evaluate(() => [...document.querySelectorAll("li button")].map((b) => b.textContent?.slice(0, 40)).slice(0, 5).join(" ; ")));
      log(tag, "url after broken:", page.url());

      // 9. reload page on that URL
      await page.reload({ waitUntil: "networkidle0" });
      await sleep(1500);
      await shot(page, `${OUT}/${tag}-07-reload-after-broken.png`);
      log(tag, "after reload url:", page.url());
    } else {
      // desktop: log tab + lint tab view
      await clickText(page, '[role="tab"]', "log");
      await sleep(1200);
      await shot(page, `${OUT}/${tag}-05-log.png`);
      await clickText(page, '[role="tab"]', "점검");
      await sleep(1500);
      await shot(page, `${OUT}/${tag}-06-lint.png`, { fullPage: true });
      // large doc
      await clickText(page, "li button", "large-128p.pdf");
      await sleep(2000);
      await clickText(page, '[role="tab"]', "위키");
      await sleep(1500);
      await shot(page, `${OUT}/${tag}-07-large.png`);
    }
  } catch (e) {
    log(tag, "EXCEPTION", e.message);
    await shot(page, `${OUT}/${tag}-exception.png`);
  }
  log(tag, "LOGS:", JSON.stringify(logs.filter((l) => !/\[(log|info|debug)\]/.test(l)), null, 0));
  await browser.close();
}
