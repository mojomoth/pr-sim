// Reviewer round 2 UI test: upload a NEW pdf via the file input (mobile), watch live progress, then browse/query/lint/log.
import { launch, shot } from "../../scripts/browser.mjs";
const BASE = "http://localhost:3100";
const OUT = ".verify/wiki/review/r2";
const PDF = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = [];
const ok = (name, cond, extra = "") => { res.push({ name, pass: !!cond, extra }); console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`); };
const bad4xx = [];
async function run(mobile) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/wiki")) bad4xx.push(`${tag} ${r.status()} ${r.url()}`); });
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/wiki`, { waitUntil: "networkidle2" });
  await sleep(800);
  await shot(page, `${OUT}/${tag}-01-landing.png`);
  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${tag} no page h-overflow on landing`, (await overflow()) <= 0, String(await overflow()));
  if (mobile && PDF) {
    // upload new PDF
    const input = await page.$('input[type=file]');
    const t0 = Date.now();
    await input.uploadFile(PDF);
    const snaps = [];
    let done = false;
    for (let i = 0; i < 80 && !done; i++) {
      await sleep(3000);
      const txt = await page.evaluate(() => document.body.innerText);
      const m = txt.match(/청크[^\n]{0,30}/g);
      snaps.push(`${Math.round((Date.now() - t0) / 1000)}s ${m?.slice(0, 2).join(" | ")}`);
      if (i === 3 || i === 10) await shot(page, `${OUT}/${tag}-02-progress-${i}.png`);
      const list = await page.evaluate(() => [...document.querySelectorAll("li button[aria-current=true]")].map((b) => b.innerText).join(""));
      if (/완료/.test(list) && /위키 [1-9]/.test(list)) done = true;
      if (/오류/.test(list)) { ok("m upload ingest did not error", false, list); break; }
    }
    console.log(snaps.join("\n"));
    ok("m upload ingest finished", done, `${Math.round((Date.now() - t0) / 1000)}s`);
    await sleep(1500);
    await shot(page, `${OUT}/${tag}-03-upload-done.png`);
    const h2 = await page.evaluate(() => document.querySelector("article h2")?.textContent);
    ok("m overview rendered after upload", !!h2, h2 ?? "");
  } else {
    // pick proposal
    const btn = await page.evaluateHandle(() => [...document.querySelectorAll("li button")].find((b) => b.innerText.includes("proposal.pdf")));
    await btn.click();
    await sleep(2000);
  }
  // click first wikilink in article
  const before = await page.evaluate(() => new URL(location.href).searchParams.get("page"));
  const linkClicked = await page.evaluate(() => { const b = [...document.querySelectorAll("article button[title$='열기']")].find((x) => !/index|log|overview/.test(x.title)); if (b) { b.click(); return b.title; } return null; });
  await sleep(1500);
  const after = await page.evaluate(() => new URL(location.href).searchParams.get("page"));
  ok(`${tag} wikilink navigates`, linkClicked && after !== before, `${before} -> ${after} (${linkClicked})`);
  await shot(page, `${OUT}/${tag}-04-linked-page.png`, { fullPage: false });
  // citation chip
  const cite = await page.evaluate(() => { const b = document.querySelector("article button[aria-label^='원문']"); if (b) { b.click(); return b.getAttribute("aria-label"); } return null; });
  await sleep(1200);
  const sheet = await page.evaluate(() => { const d = document.querySelector("[role=dialog]"); return d ? d.innerText.slice(0, 300) : null; });
  ok(`${tag} citation opens raw sheet`, cite && sheet && sheet.length > 40, cite ?? "");
  await shot(page, `${OUT}/${tag}-05-raw-sheet.png`);
  await page.evaluate(() => document.querySelector("[role=dialog] button[aria-label='닫기']")?.click());
  await sleep(500);
  // query tab
  await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "질의")?.click());
  await sleep(500);
  await page.type("textarea, input[placeholder^='예:']", "경쟁 제품 대비 가격은 어떤가?");
  const tq = Date.now();
  await page.evaluate(() => document.querySelector("form button[type=submit]")?.click());
  let answered = false;
  let qerr = null;
  for (let i = 0; i < 140 && !answered && !qerr; i++) { await sleep(500); answered = await page.evaluate(() => !!document.querySelector("[role=img][aria-label^='전문 대비']")); qerr = await page.evaluate(() => [...document.querySelectorAll("[role=alert], p.text-error")].map((a) => a.innerText).join(" ") || null); }
  ok(`${tag} query answered in UI`, answered, `${Date.now() - tq}ms err=${qerr}`);
  await shot(page, `${OUT}/${tag}-06a-query-viewport.png`);
  await sleep(2500);
  await shot(page, `${OUT}/${tag}-06-query.png`, { fullPage: true });
  ok(`${tag} no page h-overflow on query`, (await overflow()) <= 0, String(await overflow()));
  // lint tab
  await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "점검")?.click());
  await sleep(1500);
  await shot(page, `${OUT}/${tag}-07-lint.png`, { fullPage: true });
  // log tab
  await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "log")?.click());
  await sleep(1500);
  const logTxt = await page.evaluate(() => document.querySelector("article")?.innerText ?? "");
  ok(`${tag} log shows ingest + query entries`, /ingest/.test(logTxt) && /query/.test(logTxt), logTxt.length + " chars");
  await shot(page, `${OUT}/${tag}-08-log.png`);
  const errs = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  ok(`${tag} console errors`, errs.length === 0, errs.join(" || ").slice(0, 400));
  await browser.close();
}
await run(true);
await run(false);
ok("no 4xx/5xx on /api/wiki", bad4xx.length === 0, bad4xx.join(" | "));
console.log(`\n${res.filter((r) => r.pass).length}/${res.length} PASS`);
