// Fix round 2 verification: approved BI logo, failed replace keeps file, 5 judges all ask, StepHeader lockup, color media.
// Run from pocs/: node ui/tests/fix-r2.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const out = ".verify/ui/fix-r2";
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
  console.log(results.at(-1));
};
const text = (page) => page.evaluate(() => document.body.innerText);
const errs = (logs) => logs.filter((l) => /\[error\]|pageerror/.test(l));
const clickText = (page, txt) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button,a")].find((e) => e.textContent.replace(/\s+/g, " ").trim() === t && e.offsetParent !== null && !e.disabled);
    if (b) b.click();
    return !!b;
  }, txt);
const ROUTES = ["/ui", "/ui/setup", "/ui/presentation", "/ui/review", "/ui/results", "/ui/feedback", "/ui/history", "/ui/screens"];

// ---------- 1. Brand logo on every route (mobile + desktop) ----------
for (const mobile of [true, false]) {
  const { browser, page, logs } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1280, height: 860 });
  for (const r of ROUTES) {
    await page.goto(BASE + r + (r.includes("presentation") || r.includes("review") ? "?sec=600" : ""), { waitUntil: "networkidle0" });
    await sleep(500);
    const info = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")];
      // /ui landing was redesigned separately (ui/screens/Landing.tsx + public/landing/brand-lockup.webp).
      const lock = imgs.find((i) => i.src.includes("/ui/brand/lockup-black.png") || i.src.includes("brand-lockup.webp"));
      const gray = imgs.filter((i) => /grayscale/.test(getComputedStyle(i).filter) && !/hero-stage/.test(i.src)).map((i) => i.src.split("/").pop());
      const old = imgs.some((i) => i.src.includes("/brand/symbol.svg"));
      if (!lock) return { lock: false, old, gray };
      const b = lock.getBoundingClientRect();
      return { lock: true, old, gray, loaded: lock.complete && lock.naturalWidth > 0, w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left), y: Math.round(b.top) };
    });
    check(`${mobile ? "m" : "d"} ${r} no old STAGE symbol`, !info.old, JSON.stringify(info));
    check(`${mobile ? "m" : "d"} ${r} approved lockup top-left`, info.lock && info.y < 60, JSON.stringify(info));
    check(`${mobile ? "m" : "d"} ${r} no grayscale media`, info.gray.length === 0, info.gray.join(","));
    if (info.lock && r !== "/ui") check(`${mobile ? "m" : "d"} ${r} lockup loaded, ratio kept`, info.loaded && Math.abs(info.w / info.h - 310 / 96) < 0.05, `${info.w}x${info.h} @${info.x},${info.y}`);
    await shot(page, `${out}/${mobile ? "m" : "d"}${r.replaceAll("/", "_")}.png`);
  }
  check(`${mobile ? "m" : "d"} no console errors`, errs(logs).length === 0, errs(logs).join(" | "));
  await browser.close();
}

// ---------- 2. Failed replace keeps the existing file ----------
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  writeFileSync(`${out}/x.txt`, "hello");
  const inputs = await page.$$('input[type="file"]');
  // first-time failure → error box with 다시 시도 + 닫기
  await inputs[0].uploadFile(path.resolve(`${out}/x.txt`));
  await sleep(1500);
  check("empty → bad file shows 업로드 실패", (await text(page)).includes("업로드 실패"));
  await page.click('button[aria-label="오류 닫기"]');
  await sleep(200);
  const t0 = await text(page);
  check("dismiss returns to empty state", !t0.includes("업로드 실패") && t0.includes("PDF 업로드 (필수)"));
  await inputs[0].uploadFile(path.resolve("fixtures/presentation.pdf"));
  await sleep(2500);
  check("valid upload shows file", (await text(page)).includes("presentation.pdf"));
  await inputs[0].uploadFile(path.resolve(`${out}/x.txt`));
  await sleep(1500);
  const t1 = await text(page);
  const cta = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("발표 시작하기") && b.offsetParent && !b.disabled));
  check("bad replace keeps prior file visible", t1.includes("presentation.pdf") && t1.includes("교체 실패") && t1.includes("기존 파일을 계속 사용해요"), `cta=${cta}`);
  check("CTA consistent with visible file (enabled)", cta);
  await page.evaluate(() => document.querySelector('[role="alert"]')?.scrollIntoView({ block: "center" }));
  await sleep(300);
  await shot(page, `${out}/setup-bad-replace.png`);
  await page.click('button[aria-label="오류 닫기"]');
  await sleep(200);
  const t2 = await text(page);
  check("dismiss replace error keeps file", !t2.includes("교체 실패") && t2.includes("presentation.pdf"));
  // replace error then remove → empty, no stale error
  await inputs[0].uploadFile(path.resolve(`${out}/x.txt`));
  await sleep(1500);
  await page.click('button[aria-label="발표 자료 삭제"]').catch(async () => {
    const lbl = await page.$$eval('button[aria-label$="삭제"]', (b) => b.map((x) => x.getAttribute("aria-label")));
    console.log("delete labels", lbl);
    await page.click(`button[aria-label="${lbl.find((l) => l.includes("발표"))}"]`);
  });
  await sleep(200);
  const t3 = await text(page);
  check("remove after failed replace → clean empty state", !t3.includes("교체 실패") && !t3.includes("업로드 실패") && !t3.includes("presentation.pdf"));
  check("upload: no console errors", errs(logs).length === 0, errs(logs).join(" | "));
  await browser.close();
}

// ---------- 3. Five judges → each asks at least once ----------
for (const mobile of [true, false]) {
  const { browser, page, logs } = await launch({ mobile });
  if (!mobile) await page.setViewport({ width: 1280, height: 860 });
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await clickText(page, "추가");
  await sleep(200);
  await clickText(page, "추가");
  await sleep(200);
  const names = await page.$$eval('ul[aria-label="심사위원 목록"] > li', (l) => l.map((x) => x.innerText.split("\n")[0].trim()));
  check(`${mobile ? "m" : "d"} 5 judges configured`, names.length === 5, names.join(","));
  await page.goto(BASE + "/ui/review?sec=600", { waitUntil: "networkidle0" });
  await sleep(1200);
  const seen = new Set();
  let pager = "";
  for (let i = 0; i < 6; i++) {
    const t = await text(page);
    const m = t.match(/(\d+) \/ (\d+)/);
    if (i === 0) pager = m?.[0] ?? "";
    for (const n of ["민서", "준호", "도윤", "서연", "지훈"]) if (t.includes(n + " ·") || t.includes(n + "\n")) seen.add(n);
    if (!mobile && i === 0) {
      const strip = await page.$$eval('ol[aria-label="질문 순서"] > li', (l) => l.map((x) => x.innerText.trim()));
      check("d question strip lists 5", strip.length === 5, strip.join(" | "));
      await shot(page, `${out}/d_review_5judges.png`);
    }
    if (mobile && i === 4) await shot(page, `${out}/m_review_q5.png`);
    if (i === 4) {
      const hero = await page.evaluate(() => document.body.innerText.match(/(\d+) \/ 5/)?.[0]);
      check(`${mobile ? "m" : "d"} reaches question 5 / 5`, hero === "5 / 5", hero);
      const t5 = await text(page);
      check(`${mobile ? "m" : "d"} 5th question asked by 지훈`, /지훈/.test(t5));
      break;
    }
    await sleep(2500);
    const ok = await clickText(page, "답변 완료");
    if (!ok) {
      await sleep(2000);
      await clickText(page, "답변 완료");
    }
    await sleep(700);
  }
  check(`${mobile ? "m" : "d"} pager shows N / 5`, /\/ 5$/.test(pager), pager);
  check(`${mobile ? "m" : "d"} all 5 judges appeared`, seen.size === 5, [...seen].join(","));
  check(`${mobile ? "m" : "d"} review: no console errors`, errs(logs).length === 0, errs(logs).join(" | "));
  await browser.close();
}

writeFileSync(`${out}/results.txt`, results.join("\n") + "\n");
const fails = results.filter((r) => r.startsWith("FAIL"));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
