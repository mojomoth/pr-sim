// Reviewer round 3 UI test (mobile + desktop): landing, proposal browse, wikilink, cite sheet, query (degraded providers),
// lint, log, sandbox error doc. Run from pocs/: node wiki/tests/review-r3-ui.mjs [sandboxDocId]
import { launch, shot } from "../../scripts/browser.mjs";
const BASE = "http://localhost:3100";
const OUT = ".verify/wiki/review/r3";
const SANDBOX = process.argv[2];
const PROPOSAL = "cb3e5a08f4107921";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = [];
const ok = (name, cond, extra = "") => {
  res.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`);
};
const httpErr = [];
async function run(mobile) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/api/wiki")) httpErr.push(`${tag} ${r.status()} ${r.url()}`);
  });
  page.on("dialog", (d) => d.dismiss());
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto(`${BASE}/wiki`, { waitUntil: "networkidle2" });
  await sleep(1000);
  await shot(page, `${OUT}/${tag}-01-landing.png`);
  await shot(page, `${OUT}/${tag}-01-landing-full.png`, { fullPage: true });
  ok(`${tag} landing no h-overflow`, (await overflow()) <= 0, String(await overflow()));
  // proposal
  await page.goto(`${BASE}/wiki?doc=${PROPOSAL}`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const h = await page.evaluate(() => document.querySelector("article h1, article h2")?.textContent);
  ok(`${tag} overview rendered`, !!h, h ?? "");
  await shot(page, `${OUT}/${tag}-02-overview.png`);
  // wikilink
  const before = await page.evaluate(() => new URL(location.href).searchParams.get("page"));
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("article button[title$='열기']")].find((x) => !/index|log|overview/.test(x.title));
    if (b) { b.click(); return b.title; }
    return null;
  });
  await sleep(1500);
  const after = await page.evaluate(() => new URL(location.href).searchParams.get("page"));
  ok(`${tag} wikilink navigates`, clicked && after !== before, `${before} -> ${after} (${clicked})`);
  // cite sheet
  const cite = await page.evaluate(() => {
    const b = document.querySelector("article button[aria-label^='원문']");
    if (b) { b.click(); return b.getAttribute("aria-label"); }
    return null;
  });
  await sleep(1200);
  const sheet = await page.evaluate(() => document.querySelector("[role=dialog]")?.innerText.slice(0, 200) ?? null);
  ok(`${tag} cite opens raw sheet`, cite && sheet && sheet.length > 40, cite ?? "");
  await shot(page, `${OUT}/${tag}-03-sheet.png`);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector("[role=dialog] button[aria-label='닫기']")?.click());
  await sleep(400);
  // query
  await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "질의")?.click());
  await sleep(500);
  await page.type("textarea, input[placeholder^='예:']", "단위 원가와 매출총이익률은?");
  const tq = Date.now();
  await page.evaluate(() => document.querySelector("form button[type=submit]")?.click());
  let done = false;
  for (let i = 0; i < 120 && !done; i++) {
    await sleep(500);
    done = await page.evaluate(() => !!document.querySelector("[role=img][aria-label^='전문 대비']"));
  }
  const qtxt = await page.evaluate(() => document.body.innerText);
  ok(`${tag} query result shown`, done, `${Date.now() - tq}ms`);
  ok(`${tag} query context contains 142원`, /142\s?원/.test(qtxt));
  ok(`${tag} degraded answer explained in Korean`, /답변을 만들지 못했습니다|크레딧|한도/.test(qtxt));
  await sleep(1000);
  await shot(page, `${OUT}/${tag}-04-query.png`, { fullPage: true });
  ok(`${tag} query no h-overflow`, (await overflow()) <= 0, String(await overflow()));
  // lint
  await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "점검")?.click());
  await sleep(1200);
  await shot(page, `${OUT}/${tag}-05-lint-tab.png`, { fullPage: true });
  const runBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /점검 실행|실행/.test(x.textContent ?? ""));
    if (b) { b.click(); return b.textContent; }
    return null;
  });
  await sleep(4000);
  const ltxt = await page.evaluate(() => document.body.innerText);
  ok(`${tag} lint run`, !!runBtn, runBtn ?? "");
  await shot(page, `${OUT}/${tag}-06-lint-run.png`, { fullPage: true });
  console.log(`${tag} lint snippet:`, ltxt.slice(ltxt.indexOf("점검"), ltxt.indexOf("점검") + 600).replace(/\n+/g, " | "));
  // log
  await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === "log")?.click());
  await sleep(1200);
  await shot(page, `${OUT}/${tag}-07-log.png`);
  // sandbox error doc
  if (SANDBOX) {
    await page.goto(`${BASE}/wiki?doc=${SANDBOX}`, { waitUntil: "networkidle2" });
    await sleep(1500);
    await shot(page, `${OUT}/${tag}-08-sandbox-error.png`, { fullPage: !mobile });
    const st = await page.evaluate(() => document.body.innerText);
    console.log(`${tag} sandbox text:`, st.slice(0, 900).replace(/\n+/g, " | "));
  }
  const errs = logs.filter((l) => /\[error\]|pageerror/.test(l));
  ok(`${tag} console errors 0`, errs.length === 0, errs.slice(0, 5).join(" ; "));
  await browser.close();
}
await run(true);
await run(false);
console.log("HTTP>=400:", httpErr.join("\n"));
console.log(`${res.filter((r) => r.pass).length}/${res.length} PASS`);
