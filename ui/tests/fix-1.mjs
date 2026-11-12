// Fixer round 1 verification. Run from pocs/: node ui/tests/fix-1.mjs
// Covers: portrait PDF stage fit + sticky phase bar, sample PDF blob reuse, history resume/view per record,
// back-chevron confirm, LCP warnings, landing dot.
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";

const out = ".verify/ui/fix";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
};
const clickText = (page, text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll("button,a")].find((b) => b.textContent.trim().includes(t) && b.offsetParent);
    el?.click();
    return !!el;
  }, text);
const timerText = (p) => p.$eval('[data-testid="timer"]', (e) => e.textContent.trim());
const timerTop = (p) => p.$eval('[data-testid="timer"]', (e) => Math.round(e.getBoundingClientRect().top));

async function geometry(page) {
  return page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const stage = r(document.querySelector('section[aria-label="발표 자료"]'));
    const canvas = r(document.querySelector('[data-testid="pdf-page"] canvas'));
    const counter = r(document.querySelector('[data-testid="slide-counter"]'));
    const next = r(document.querySelector('button[aria-label="다음 슬라이드"]'));
    const bar = [...document.querySelectorAll("div,footer,nav")].find((e) => getComputedStyle(e).position === "fixed" && e.textContent.includes("발표 마치기"));
    return {
      vh: innerHeight,
      stage: stage && { top: Math.round(stage.top), bottom: Math.round(stage.bottom), h: Math.round(stage.height) },
      canvas: canvas && { w: Math.round(canvas.width), h: Math.round(canvas.height) },
      counterBottom: counter && Math.round(counter.bottom),
      nextBottom: next && Math.round(next.bottom),
      barTop: bar ? Math.round(r(bar).top) : null,
      label: document.querySelector('[data-testid="slide-counter"]')?.textContent,
    };
  });
}

for (const mobile of [true, false]) {
  const tag = mobile ? "m" : "d";
  const { browser, page, logs } = await launch({ mobile });
  const fixtureFetches = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/ui/fixture") && !u.includes("check=1")) fixtureFetches.push(u);
  });

  // ---- A. Portrait PDF (fixtures/proposal.pdf, A4 58p) as 발표 자료
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  const inputs = await page.$$('input[type="file"]');
  await inputs[0].uploadFile(path.resolve("fixtures/proposal.pdf"));
  await page.waitForFunction(() => document.body.innerText.includes("58"), { timeout: 15000 });
  await clickText(page, "발표 시작하기");
  await page.waitForFunction(() => location.pathname === "/ui/presentation");
  await page.waitForSelector('[data-testid="pdf-page"] canvas');
  await sleep(2500);
  let g = await geometry(page);
  console.log(tag, "portrait", JSON.stringify(g));
  await shot(page, `${out}/${tag}-portrait-top.png`);
  check(`${tag} portrait: slide controls above bottom bar`, g.nextBottom <= g.barTop && g.counterBottom <= g.barTop, `next.bottom=${g.nextBottom} bar.top=${g.barTop}`);
  check(`${tag} portrait: canvas is portrait & letterboxed`, g.canvas.h > g.canvas.w && g.stage.bottom <= g.vh, `canvas ${g.canvas.w}x${g.canvas.h}, stage bottom ${g.stage.bottom}/${g.vh}`);
  // nav still works
  await page.click('button[aria-label="다음 슬라이드"]');
  await sleep(800);
  check(`${tag} portrait: next → 2 / 58`, (await page.$eval('[data-testid="slide-counter"]', (e) => e.textContent.trim())) === "2 / 58");
  // sticky timer
  await page.evaluate(() => window.scrollTo(0, 600));
  await sleep(500);
  const tt = await timerTop(page);
  check(`${tag} timer stays pinned after scroll`, tt >= 0 && tt < 140, `timer top=${tt}`);
  await shot(page, `${out}/${tag}-portrait-scrolled.png`);
  await page.evaluate(() => window.scrollTo(0, 0));
  // fullscreen portrait fits viewport
  await page.click('button[aria-label="슬라이드 크게 보기"]');
  await sleep(1500);
  const fs = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[role="dialog"] canvas')][0]?.getBoundingClientRect();
    return c && { h: Math.round(c.height), bottom: Math.round(c.bottom), vh: innerHeight };
  });
  check(`${tag} fullscreen portrait fits viewport`, fs && fs.bottom <= fs.vh - 60, JSON.stringify(fs));
  await shot(page, `${out}/${tag}-portrait-full.png`);
  await page.keyboard.press("Escape");
  await sleep(300);

  // ---- E. Back chevron → confirm dialog
  await page.click('header button[aria-label="뒤로 가기"]');
  await sleep(400);
  const dlg = await page.$eval('[role="dialog"]', (d) => d.textContent).catch(() => null);
  check(`${tag} back chevron opens confirm`, !!dlg && dlg.includes("발표를 멈추고 나갈까요?"), dlg?.slice(0, 30));
  await shot(page, `${out}/${tag}-back-confirm.png`);
  if (mobile) {
    // 계속하기 keeps you on the page
    await clickText(page, "계속하기");
    await sleep(300);
    check("m 계속하기 stays on presentation", (await page.evaluate(() => location.pathname)) === "/ui/presentation" && !(await page.$('[role="dialog"]')));
    await page.click('header button[aria-label="뒤로 가기"]');
    await sleep(300);
  }
  const before = await timerText(page);
  await clickText(page, "나가기");
  await page.waitForFunction(() => location.pathname === "/ui/setup");
  check(`${tag} 나가기 → /ui/setup`, true, `left at ${before}`);

  // ---- current in_progress record → 이어하기 resumes at saved time
  await page.goto(BASE + "/ui/history", { waitUntil: "networkidle0" });
  const cur = await page.evaluate(() => document.querySelector('[data-testid="history-list"] li')?.innerText);
  check(`${tag} history top = 방금 진행 중 + remaining`, /진행 중/.test(cur) && /방금/.test(cur) && /남음/.test(cur), cur?.replace(/\n/g, " | "));

  // ---- D. mock 진행 중 record (10분, 06:12 남음) → 이어하기
  await clickText(page, "진행 중");
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "프로젝트 최종 발표 이어하기")?.click());
  await page.waitForFunction(() => location.pathname === "/ui/presentation");
  await sleep(700);
  const t1 = await timerText(page);
  const lbl = await page.evaluate(() => document.body.innerText.includes("발표 남은 시간 · 이어하기"));
  check(`${tag} 이어하기 resumes at 06:12 of 10분`, /^06:1[0-2]$/.test(t1) && lbl, `timer=${t1}`);
  await shot(page, `${out}/${tag}-resume.png`);

  // 결과 보기 on the 76점 record
  await page.goto(BASE + "/ui/history", { waitUntil: "networkidle0" });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "신규 서비스 투자 제안 결과 보기")?.click());
  await page.waitForFunction(() => location.pathname === "/ui/results");
  await sleep(500);
  const score = await page.$eval('[data-testid="total-score"]', (e) => e.textContent.trim());
  const sub = await page.evaluate(() => document.body.innerText.includes("신규 서비스 투자 제안") && document.body.innerText.includes("2026.11.10"));
  check(`${tag} 결과 보기 shows that record (76)`, score === "76" && sub, `score=${score}`);
  await shot(page, `${out}/${tag}-results-76.png`);

  // ---- 샘플 자료 사용: blob kept, fetched once, labelled 샘플 PDF
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  // remove current 발표 자료 if present
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /발표 자료.*삭제/.test(b.getAttribute("aria-label") ?? ""))?.click());
  await sleep(300);
  fixtureFetches.length = 0;
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("샘플 자료 사용") && x.offsetParent);
    b?.click();
    return !!b;
  });
  await page.waitForFunction(() => document.body.innerText.includes("presentation.pdf") || document.body.innerText.includes("12"), { timeout: 15000 });
  await sleep(800);
  await clickText(page, "발표 시작하기");
  await page.waitForFunction(() => location.pathname === "/ui/presentation");
  await page.waitForSelector('[data-testid="pdf-page"] canvas');
  await sleep(2000);
  const src = await page.evaluate(() => document.querySelector('section[aria-label="발표 자료"]')?.innerText);
  g = await geometry(page);
  check(`${tag} sample: one fixture download, labelled 샘플 PDF`, clicked && fixtureFetches.length === 1 && /샘플 PDF/.test(src), `fetches=${fixtureFetches.length}`);
  check(`${tag} 16:9 deck unchanged (wide canvas, controls visible)`, g.canvas.w > g.canvas.h && g.nextBottom <= g.barTop, JSON.stringify(g.canvas));
  await shot(page, `${out}/${tag}-sample-169.png`);

  // ---- C. console: errors + LCP warnings across routes
  logs.length = 0;
  for (const r of ["/ui", "/ui/setup", "/ui/presentation", "/ui/review", "/ui/results", "/ui/feedback", "/ui/history"]) {
    await page.goto(BASE + r, { waitUntil: "networkidle0" });
    await sleep(3500); // preload-unused warnings fire ~3s after load
  }
  const bad = logs.filter((l) => /\[error\]|pageerror|Largest Contentful Paint|\[warn/.test(l));
  check(`${tag} console: no errors / warnings on 7 routes`, bad.length === 0, bad.slice(0, 3).join(" ¦ "));

  // ---- F. landing dot
  await page.goto(BASE + "/ui", { waitUntil: "networkidle0" });
  await sleep(600);
  const dot = await page.evaluate(() => {
    const d = document.querySelector("figure .ui-dot");
    const cs = getComputedStyle(d);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, w: d.getBoundingClientRect().width };
  });
  check(`${tag} landing dot solid ink, no ring`, dot.shadow === "none" || !/rgb\(255/.test(dot.shadow), JSON.stringify(dot));
  await shot(page, `${out}/${tag}-landing.png`);
  await browser.close();
}

// Review screen: sticky timer + back confirm (mobile)
{
  const { browser, page } = await launch({ mobile: true });
  await page.goto(BASE + "/ui/review", { waitUntil: "networkidle0" });
  await sleep(6000);
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(400);
  const tt = await timerTop(page);
  check("m review timer pinned after scroll", tt >= 0 && tt < 140, `top=${tt}`);
  await shot(page, `${out}/m-review-scrolled.png`);
  await page.click('header button[aria-label="뒤로 가기"]');
  await sleep(300);
  const dlg = await page.$eval('[role="dialog"]', (d) => d.textContent).catch(() => null);
  check("m review back opens confirm", !!dlg && dlg.includes("질의응답을 멈추고 나갈까요?"));
  await clickText(page, "나가기");
  await page.waitForFunction(() => location.pathname === "/ui/setup");
  await page.goto(BASE + "/ui/history", { waitUntil: "networkidle0" });
  const cur = await page.evaluate(() => document.querySelector('[data-testid="history-list"] li')?.innerText ?? "");
  check("m review exit saved as 질의응답 … 남음", /질의응답 \d\d:\d\d 남음/.test(cur), cur.replace(/\n/g, " | "));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("이어하기"))?.click());
  await page.waitForFunction(() => location.pathname === "/ui/review");
  await sleep(500);
  check("m resume 질의응답 → review with label", await page.evaluate(() => document.body.innerText.includes("질의응답 남은 시간 · 이어하기")), await timerText(page));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
