// Fix round 2 UI check (works whether or not the LLM providers are available):
//  m: upload a brand-new PDF (rendered here, unique hash) → ingest either progresses or fails FAST with a Korean message
//  m/d: proposal → query with "답변 생성" → selected pages + context always shown; answer OR Korean answerError; < 10 s
//  m/d: save button files the displayed answer (only if an answer came back)
//  d: presentation (small) → raw mode label, ratio ≈ 100%
//  m/d: lint → deterministic issues shown; llmError notice in Korean if the LLM part was skipped
// Run from pocs/: node wiki/tests/fix-r2-ui.mjs
import { mkdirSync } from "node:fs";
import { launch, shot } from "../../scripts/browser.mjs";
const BASE = "http://localhost:3100";
const OUT = ".verify/wiki/fix-r2";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = [];
const ok = (name, cond, extra = "") => {
  res.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`);
};
const bad5xx = [];
const ENGLISH_PROVIDER = /no credits|platform\.openai|usage limits|insufficient_quota|You have/i;

async function pickDoc(page, name) {
  await page.evaluate((n) => [...document.querySelectorAll("li button")].find((b) => b.innerText.includes(n))?.click(), name);
  await sleep(2000);
}
async function tab(page, label) {
  await page.evaluate((l) => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === l)?.click(), label);
  await sleep(600);
}
async function ask(page, tag, q) {
  await page.evaluate(() => {
    const t = document.querySelector("#wiki-q");
    if (t) t.value = "";
  });
  await page.click("#wiki-q", { clickCount: 3 });
  await page.type("#wiki-q", q);
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector("form button[type=submit]")?.click());
  let done = false;
  for (let i = 0; i < 200 && !done; i++) {
    await sleep(250);
    done = await page.evaluate(() => !!document.querySelector("[role=img][aria-label]") && !/검색 중/.test(document.querySelector("form button[type=submit]")?.textContent ?? ""));
  }
  const ms = Date.now() - t0;
  const info = await page.evaluate(() => ({
    chips: [...document.querySelectorAll("h3")].find((h) => h.textContent === "선택된 페이지")?.parentElement?.querySelectorAll("button").length ?? 0,
    answer: !![...document.querySelectorAll("h3")].find((h) => h.textContent === "답변"),
    answerErr: [...document.querySelectorAll("[role=alert]")].map((a) => a.innerText).join(" "),
    ratio: [...document.querySelectorAll("p")].map((p) => p.innerText).find((t) => /전문 대비/.test(t)) ?? "",
    ctxBtn: [...document.querySelectorAll("button")].find((b) => /전달되는 컨텍스트/.test(b.innerText))?.innerText ?? "",
  }));
  console.log(`  ${tag} "${q}" ${ms}ms`, JSON.stringify(info).slice(0, 400));
  return { ms, done, ...info };
}

async function run(mobile) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().includes("/api/wiki")) bad5xx.push(`${tag} ${r.status()} ${r.url()}`);
  });
  page.on("dialog", (d) => d.accept());

  if (mobile) {
    // unique PDF → new docId → a real ingest attempt
    const gen = await browser.newPage();
    await gen.setContent(
      `<html><body style="font-family:sans-serif">${[1, 2, 3]
        .map((i) => `<section style="page-break-after:always"><h1>테스트 ${i}쪽 · ${Date.now()}</h1><p>리웨이브 웨이브셀 세트당 원가 ${140 + i}원, 월 ${20 + i}만 세트 생산 계획.</p></section>`)
        .join("")}</body></html>`,
    );
    const pdfPath = `${OUT}/upload-${Date.now()}.pdf`;
    await gen.pdf({ path: pdfPath, format: "A4" });
    await gen.close();
    await page.goto(`${BASE}/wiki`, { waitUntil: "networkidle2" });
    await sleep(800);
    const input = await page.$("input[type=file]");
    const t0 = Date.now();
    await input.uploadFile(pdfPath);
    let state = "";
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      state = await page.evaluate(() => document.querySelector("li button[aria-current=true]")?.innerText ?? "");
      if (/완료|오류/.test(state)) break;
      if (i === 2) await shot(page, `${OUT}/m-01-progress.png`);
    }
    await sleep(800);
    const body = await page.evaluate(() => document.body.innerText);
    const failMsg = body.match(/위키를 만들지 못했습니다[^\n]*/)?.[0] ?? "";
    await shot(page, `${OUT}/m-02-upload-result.png`);
    const secs = Math.round((Date.now() - t0) / 1000);
    if (/오류/.test(state)) {
      ok("m upload: failure is fast", secs < 20, `${secs}s`);
      ok("m upload: failure message Korean w/ next step", failMsg && !ENGLISH_PROVIDER.test(failMsg) && /다시 시도/.test(failMsg), failMsg);
    } else ok("m upload: ingest completed", /완료/.test(state), `${secs}s ${state}`);
    ok("m progress copy is not '왼쪽' only", !/왼쪽 진행 상황에서/.test(body));
  } else {
    await page.goto(`${BASE}/wiki`, { waitUntil: "networkidle2" });
    await sleep(800);
  }

  // proposal: query
  await pickDoc(page, "proposal.pdf");
  await tab(page, "질의");
  const r1 = await ask(page, tag, `2공장 가동 시점과 생산능력은? (${tag})`);
  ok(`${tag} query result shown`, r1.done && r1.chips > 0 && r1.ctxBtn, `${r1.ms}ms chips=${r1.chips}`);
  ok(`${tag} query fast (<10s or answered)`, r1.ms < 10000 || r1.answer, `${r1.ms}ms`);
  ok(`${tag} answer or Korean answerError`, r1.answer || (r1.answerErr && !ENGLISH_PROVIDER.test(r1.answerErr)), r1.answerErr.slice(0, 160));
  await shot(page, `${OUT}/${tag}-03-query-viewport.png`);
  await shot(page, `${OUT}/${tag}-03-query-full.png`, { fullPage: true });
  if (r1.answer) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText === "이 답변을 위키 페이지로 저장")?.click());
    await sleep(1500);
    const saved = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText === "위키에 저장됨"));
    ok(`${tag} save files displayed answer`, saved);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${tag} no h-overflow on query`, overflow <= 0, String(overflow));

  // lint
  await tab(page, "점검");
  const tl = Date.now();
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText === "점검 실행")?.click());
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    if (await page.evaluate(() => ![...document.querySelectorAll("button")].some((b) => b.innerText === "점검 중…"))) break;
  }
  const lint = await page.evaluate(() => ({ count: document.querySelectorAll("li .break-keep").length, notice: [...document.querySelectorAll("[role=alert]")].map((a) => a.innerText).join(" "), err: [...document.querySelectorAll("p.text-error")].map((a) => a.innerText).join(" ") }));
  ok(`${tag} lint returns issues`, lint.count > 0, `${Date.now() - tl}ms count=${lint.count} notice=${lint.notice.slice(0, 120)}`);
  ok(`${tag} lint notice Korean`, !ENGLISH_PROVIDER.test(lint.notice + lint.err));
  await shot(page, `${OUT}/${tag}-04-lint.png`);

  if (!mobile) {
    await pickDoc(page, "presentation.pdf");
    await tab(page, "질의");
    const r2 = await ask(page, tag, "SOM은 얼마인가?");
    ok("d small doc raw-mode label, ratio ≲ 130%", /소형 문서/.test(r2.ratio) && Number(r2.ratio.match(/(\d+)%/)?.[1] ?? 999) <= 130, r2.ratio);
    await shot(page, `${OUT}/d-05-small-doc-query.png`);
  }
  const errs = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  ok(`${tag} no console errors`, errs.length === 0, errs.join(" || ").slice(0, 300));
  await browser.close();
}
await run(true);
await run(false);
ok("no 5xx on /api/wiki", bad5xx.length === 0, bad5xx.join(" | "));
console.log(`\n${res.filter((r) => r.pass).length}/${res.length} PASS`);
