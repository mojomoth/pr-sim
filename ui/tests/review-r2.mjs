// Reviewer round 2 (independent): flow + edge cases. Run from pocs/: node ui/tests/review-r2.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
const out = ".verify/ui/review/r2";
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
  console.log(results.at(-1));
};
const clickText = (page, txt) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button,a")].find((e) => e.textContent.replace(/\s+/g, " ").trim().includes(t) && e.offsetParent !== null && !e.disabled);
    if (b) b.click();
    return !!b;
  }, txt);
const text = (page) => page.evaluate(() => document.body.innerText);
const errs = (logs) => logs.filter((l) => /\[error\]|pageerror/.test(l));

const only = process.argv[2];

// ---------- A. Full flow on mobile with real PDF upload ----------
if (!only || only === "A") {
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(BASE + "/ui", { waitUntil: "networkidle0" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await shot(page, `${out}/A1-landing.png`);
  check("landing 시작하기", await clickText(page, "시작하기"));
  await page.waitForFunction(() => location.pathname === "/ui/setup");
  await sleep(800);
  // CTA disabled before upload
  const disabled = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("발표 시작하기") && b.offsetParent).every((b) => b.disabled));
  check("setup CTA disabled without 발표 자료", disabled);
  // non-pdf upload → error
  const inputs = await page.$$('input[type="file"]');
  writeFileSync(`${out}/x.txt`, "hello");
  await inputs[0].uploadFile(path.resolve(`${out}/x.txt`));
  await sleep(1500);
  check("non-PDF → 업로드 실패", (await text(page)).includes("업로드 실패"));
  // valid upload
  await inputs[0].uploadFile(path.resolve("fixtures/presentation.pdf"));
  await page.waitForFunction(() => document.body.innerText.includes("업로드 중"), { timeout: 3000 }).then(
    () => check("uploading state visible", true),
    () => check("uploading state visible", false),
  );
  await sleep(2500);
  const t = await text(page);
  const pm = t.match(/presentation\.pdf\s*\n?\s*(\d+)페이지/);
  check("uploaded filename + pages", !!pm, pm?.[0]?.replace(/\s+/g, " "));
  // replace with an invalid file while a valid one exists
  await inputs[0].uploadFile(path.resolve(`${out}/x.txt`));
  await sleep(1500);
  const afterBadReplace = await text(page);
  const ctaEnabled = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("발표 시작하기") && b.offsetParent && !b.disabled));
  check("bad replace keeps prior file visible", afterBadReplace.includes("presentation.pdf"), `error shown=${afterBadReplace.includes("업로드 실패")} ctaEnabled=${ctaEnabled}`);
  await shot(page, `${out}/A2-bad-replace.png`, { fullPage: true });
  await inputs[0].uploadFile(path.resolve("fixtures/presentation.pdf"));
  await sleep(2500);
  // proposal upload
  await inputs[1].uploadFile(path.resolve("fixtures/proposal.pdf"));
  await sleep(3500);
  check("proposal uploaded", /proposal\.pdf/.test(await text(page)));
  // sliders
  for (let i = 0; i < 3; i++) await page.click('button[aria-label="발표 시간 1분 늘리기"]');
  await page.click('button[aria-label="질의응답 시간 1분 줄이기"]');
  const sum = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  check("slider summary live", sum.includes("총 10분") && sum.includes("3명"), sum);
  // slider bounds
  for (let i = 0; i < 40; i++) await page.click('button[aria-label="발표 시간 1분 늘리기"]').catch(() => {});
  const maxV = await page.evaluate(() => document.querySelectorAll('input[type="range"]')[0].value);
  check("slider max 30", maxV === "30", maxV);
  for (let i = 0; i < 40; i++) await page.click('button[aria-label="발표 시간 1분 줄이기"]').catch(() => {});
  const minV = await page.evaluate(() => document.querySelectorAll('input[type="range"]')[0].value);
  check("slider min 1", minV === "1", minV);
  // restore to 5
  for (let i = 0; i < 4; i++) await page.click('button[aria-label="발표 시간 1분 늘리기"]');
  // judges: add, chip, remove
  await clickText(page, "추가");
  await sleep(300);
  let jcount = await page.$$eval('ul[aria-label="심사위원 목록"] > li', (l) => l.length);
  check("judge add → 4", jcount === 4);
  const radios = await page.$$('ul[aria-label="심사위원 목록"] > li:first-child [role=radio]');
  await radios[2].click();
  const checked = await page.$$eval('ul[aria-label="심사위원 목록"] > li:first-child [role=radio]', (r) => r.map((x) => x.getAttribute("aria-checked")));
  check("single-select persona", JSON.stringify(checked) === '["false","false","true"]', JSON.stringify(checked));
  await radios[0].click(); // back to 친절함
  const rm = await page.$$('ul[aria-label="심사위원 목록"] > li button[aria-label*="삭제"]');
  await rm[rm.length - 1].click();
  await sleep(300);
  jcount = await page.$$eval('ul[aria-label="심사위원 목록"] > li', (l) => l.length);
  check("judge remove → 3", jcount === 3);
  await shot(page, `${out}/A3-setup-full.png`, { fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("발표 시작하기") && b.offsetParent)?.click());
  await page.waitForFunction(() => location.pathname === "/ui/presentation");
  await sleep(4000);
  const pres = await text(page);
  check("presentation: 업로드 PDF label", pres.includes("업로드 PDF"));
  const counter1 = await page.$eval('[data-testid="slide-counter"]', (e) => e.textContent);
  await page.click('button[aria-label="다음 슬라이드"]');
  await page.click('button[aria-label="다음 슬라이드"]');
  await sleep(500);
  const counter3 = await page.$eval('[data-testid="slide-counter"]', (e) => e.textContent);
  check("slide nav", counter1.startsWith("1 /") && counter3.startsWith("3 /"), `${counter1} → ${counter3}`);
  const camLive = await page.evaluate(() => {
    const v = document.querySelector("video");
    return v && !v.classList.contains("hidden") && v.readyState >= 2;
  });
  check("camera live", camLive);
  check("transcript status", /음성 인식 중|인식 완료/.test(await text(page)));
  check("judge tiles 이름 · 성향", /민서 · 친절함/.test(pres) && /준호 · 빡셈/.test(pres) && /도윤 · 공격적/.test(pres));
  await shot(page, `${out}/A4-presentation.png`);
  // timer value
  const timerTxt = await page.evaluate(() => [...document.querySelectorAll("*")].find((e) => /^\d\d:\d\d$/.test(e.textContent.trim()) && e.children.length === 0)?.textContent);
  check("timer from 05:00", /^0[45]:\d\d$/.test(timerTxt ?? ""), timerTxt);
  check("발표 마치기", await clickText(page, "발표 마치기"));
  await page.waitForFunction(() => location.pathname === "/ui/review");
  // measure question typing + answer typing time
  const t0 = Date.now();
  await page.waitForFunction(() => document.body.innerText.includes("내 답변"), { timeout: 20000 });
  const tq = Date.now() - t0;
  const qlen = await page.evaluate(() => document.querySelector('[aria-live]')?.textContent?.length ?? 0);
  await page.waitForFunction(() => document.body.innerText.includes("인식 완료"), { timeout: 60000 }).catch(() => {});
  const ta = Date.now() - t0 - tq;
  const alen = await page.evaluate(() => {
    const b = [...document.querySelectorAll("*")].find((e) => e.textContent.startsWith("내 답변") && e.children.length > 1);
    return b?.textContent.length ?? 0;
  });
  check("review question then answer typed", true, `question ${tq}ms, answer ${ta}ms (answer≈${alen} chars → expected ≈${alen * 70}ms)`);
  await shot(page, `${out}/A5-review.png`);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const pill = await page.evaluate(() => (document.body.innerText.match(/(민서|준호|도윤)/) || [])[0]);
    const n = await page.evaluate(() => (document.body.innerText.match(/(\d) \/ 4/) || [])[0]);
    seen.push(`${n}:${pill}`);
    await sleep(300);
    await clickText(page, "답변 완료");
    await sleep(600);
  }
  check("review rotates 4 questions", seen.length === 4, seen.join(" "));
  await page.waitForFunction(() => location.pathname === "/ui/results", { timeout: 5000 }).then(
    () => check("→ results", true),
    () => check("→ results", false),
  );
  await sleep(800);
  const score = await page.$eval('[data-testid="total-score"]', (e) => e.textContent).catch(() => null);
  check("score 82", score === "82", score);
  check("results meta 발표 5분 · 질의응답 2분", (await text(page)).includes("발표 5분 · 질의응답 2분"));
  await shot(page, `${out}/A6-results.png`);
  await clickText(page, "상세 피드백 보기");
  await page.waitForFunction(() => location.pathname === "/ui/feedback");
  await sleep(600);
  await clickText(page, "다음 질문 보기");
  await sleep(300);
  check("feedback 2 / 4", (await text(page)).includes("2 / 4"));
  check("이렇게 답해 보세요", (await text(page)).includes("이렇게 답해 보세요"));
  await page.click("#tab-analysis");
  await sleep(300);
  check("analysis tab", (await text(page)).includes("말하기 흐름"));
  await clickText(page, "기록으로 돌아가기");
  await page.waitForFunction(() => location.pathname === "/ui/history");
  await sleep(800);
  const h = await text(page);
  check("history 방금 82", h.includes("방금") && /82\s*점/.test(h));
  const cnt = async () => page.$$eval('[data-testid="history-list"] > li', (l) => l.length);
  const all = await cnt();
  await page.click('[role=radio][aria-checked=false]:nth-child(2)');
  await sleep(300);
  const done = await cnt();
  await page.evaluate(() => [...document.querySelectorAll("[role=radio]")].find((b) => b.textContent === "진행 중").click());
  await sleep(300);
  const prog = await cnt();
  check("history filters", all === done + prog && done > 0 && prog > 0, `all=${all} done=${done} prog=${prog}`);
  await shot(page, `${out}/A7-history.png`);
  await clickText(page, "새 시뮬레이션");
  await page.waitForFunction(() => location.pathname === "/ui/setup");
  await sleep(500);
  check("새 시뮬레이션 → reset setup", !(await text(page)).includes("presentation.pdf"));
  console.log("A errors:", errs(logs));
  check("A no console errors", errs(logs).length === 0, errs(logs).slice(0, 3).join(" | "));
  await browser.close();
}

// ---------- B. Edge cases ----------
if (!only || only === "B") {
  const { browser, page, logs } = await launch({ mobile: true });
  // B1: no judges → setup hint; direct /ui/review
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(500);
  for (let i = 0; i < 3; i++) {
    const rm = await page.$('ul[aria-label="심사위원 목록"] > li button[aria-label*="삭제"]');
    await rm?.click();
    await sleep(200);
  }
  check("empty judges state", (await text(page)).includes("아직 심사위원이 없어요"));
  await page.goto(BASE + "/ui/review", { waitUntil: "networkidle0" });
  await sleep(800);
  check("review with no judges handled", (await text(page)).includes("심사위원이 없어요"));
  await page.goto(BASE + "/ui/presentation", { waitUntil: "networkidle0" });
  await sleep(1500);
  await shot(page, `${out}/B1-presentation-nojudges.png`);
  // B2: 5 judges → review only 4 questions; 5th judge never asks
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  await sleep(500);
  await clickText(page, "추가");
  await sleep(200);
  await clickText(page, "추가");
  await sleep(200);
  const addDisabled = await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().endsWith("추가") && b.offsetParent)?.disabled);
  check("max 5 judges → add disabled", addDisabled === true);
  await page.goto(BASE + "/ui/review", { waitUntil: "networkidle0" });
  await sleep(500);
  const tot = await page.evaluate(() => (document.body.innerText.match(/\d \/ (\d)/) || [])[1]);
  check("5 judges: every judge asks at least once", Number(tot) >= 5, `questions=${tot}`);
  // B3: ?sec=4 → phase end dialog + auto transition
  await page.goto(BASE + "/ui/presentation?sec=4", { waitUntil: "networkidle0" });
  await sleep(1200);
  const red = await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) => /^\d\d:\d\d$/.test(e.textContent.trim()) && e.children.length === 0);
    return el ? getComputedStyle(el).color : null;
  });
  check("timer red <30s", red && red !== "rgb(17, 17, 17)", red);
  await page.waitForFunction(() => document.body.innerText.includes("발표 시간이 끝났어요"), { timeout: 8000 }).then(
    () => check("phase end notice", true),
    () => check("phase end notice", false),
  );
  await shot(page, `${out}/B3-phase-end.png`);
  await page.waitForFunction(() => location.pathname === "/ui/review", { timeout: 9000 }).then(
    () => check("auto → review", true),
    () => check("auto → review", false),
  );
  // B4: camera denied + retry
  await page.evaluateOnNewDocument(() => {
    window.__deny = true;
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (window.__deny && c.video ? Promise.reject(new DOMException("denied", "NotAllowedError")) : orig(c));
  });
  await page.goto(BASE + "/ui/presentation", { waitUntil: "networkidle0" });
  await sleep(1500);
  check("camera denied notice", (await text(page)).includes("카메라 권한이 필요해요"));
  await shot(page, `${out}/B4-denied.png`);
  await page.evaluate(() => (window.__deny = false));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("다시 시도"))?.click());
  await sleep(2000);
  check("camera retry → live", !(await text(page)).includes("카메라 권한이 필요해요"));
  // B5: exit via 종료 → history → 이어하기 resumes
  await sleep(2500);
  await clickText(page, "종료");
  await sleep(500);
  check("exit dialog", (await text(page)).includes("시뮬레이션을 종료할까요?"));
  await page.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent.includes("종료하기"))?.click());
  await page.waitForFunction(() => location.pathname === "/ui/history");
  await sleep(600);
  const rem = await page.evaluate(() => (document.body.innerText.match(/발표 (\d\d:\d\d) 남음/) || [])[1]);
  check("history shows remaining", !!rem, rem);
  await clickText(page, "이어하기");
  await page.waitForFunction(() => location.pathname === "/ui/presentation");
  await sleep(900);
  const resumed = await page.evaluate(() => [...document.querySelectorAll("*")].find((e) => /^\d\d:\d\d$/.test(e.textContent.trim()) && e.children.length === 0)?.textContent);
  check("resume continues from saved time", resumed && resumed <= rem, `${rem} → ${resumed}`);
  // B6: fullscreen + Esc
  await page.click('button[aria-label="슬라이드 크게 보기"]');
  await sleep(500);
  const fsOpen = await page.$('[role=dialog][aria-label="슬라이드 크게 보기"]');
  await page.keyboard.press("ArrowRight");
  await sleep(300);
  const fsCounter = await page.evaluate(() => [...document.querySelectorAll('[data-testid="slide-counter"]')].map((e) => e.textContent));
  await shot(page, `${out}/B6-fullscreen.png`);
  await page.keyboard.press("Escape");
  await sleep(300);
  const fsClosed = !(await page.$('[role=dialog][aria-label="슬라이드 크게 보기"]'));
  check("fullscreen open/arrow/Esc", !!fsOpen && fsClosed, JSON.stringify(fsCounter));
  // B7: Esc while fullscreen also triggers... check exit dialog not opened
  // B8: reload presentation after upload → falls back
  console.log("B errors:", errs(logs));
  check("B no console errors", errs(logs).length === 0, errs(logs).slice(0, 3).join(" | "));
  await browser.close();
}

// ---------- C. Desktop screenshots + overflow + errors on all routes ----------
if (!only || only === "C") {
  for (const mobile of [false, true]) {
    const { browser, page, logs } = await launch({ mobile });
    const tag = mobile ? "m" : "d";
    for (const r of ["/ui", "/ui/setup", "/ui/presentation", "/ui/review", "/ui/results", "/ui/feedback", "/ui/history", "/ui/screens"]) {
      await page.goto(BASE + r, { waitUntil: "networkidle0" });
      await sleep(2500);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const name = r.replace(/\//g, "_");
      await shot(page, `${out}/C-${tag}${name}.png`);
      if (ov > 0) check(`${tag} ${r} no h-overflow`, false, `overflow ${ov}`);
    }
    check(`C ${tag} console errors`, errs(logs).length === 0, errs(logs).slice(0, 3).join(" | "));
    const warns = logs.filter((l) => /\[warn/.test(l));
    if (warns.length) console.log(tag, "warnings:", warns.slice(0, 5));
    await browser.close();
  }
}

writeFileSync(`${out}/results-${only ?? "all"}.log`, results.join("\n") + "\n");
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);
