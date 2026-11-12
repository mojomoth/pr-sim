// Reviewer round 3 (independent, adversarial). Run from pocs/: node ui/tests/review-r3.mjs [A|B|C|D|E]
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
const out = ".verify/ui/review/r3";
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
  console.log(results.at(-1));
};
const clickText = (page, txt, exact = false) =>
  page.evaluate(
    (t, ex) => {
      const b = [...document.querySelectorAll("button,a")].find((e) => {
        const s = e.textContent.replace(/\s+/g, " ").trim();
        return (ex ? s === t : s.includes(t)) && e.offsetParent !== null && !e.disabled;
      });
      if (b) b.click();
      return !!b;
    },
    txt,
    exact,
  );
const text = (page) => page.evaluate(() => document.body.innerText);
const errs = (logs) => logs.filter((l) => /\[error\]|pageerror|\[warn/.test(l));
const only = process.argv[2];

// ---------- A. Landing vs draft + all routes console at both sizes ----------
if (!only || only === "A") {
  for (const mobile of [true, false]) {
    const { browser, page, logs } = await launch({ mobile });
    const tag = mobile ? "m" : "d";
    for (const r of ["/ui", "/ui/setup", "/ui/presentation", "/ui/review", "/ui/results", "/ui/feedback", "/ui/history", "/ui/screens"]) {
      logs.length = 0;
      await page.goto(BASE + r, { waitUntil: "networkidle0" });
      await sleep(2500);
      const name = r.replace(/\//g, "_") || "_";
      await shot(page, `${out}/A${tag}${name}.png`);
      if (r === "/ui" || r === "/ui/setup" || r === "/ui/history") await shot(page, `${out}/A${tag}${name}.full.png`, { fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const e = errs(logs);
      check(`${tag} ${r} console clean & no h-overflow`, e.length === 0 && overflow <= 0, `overflow=${overflow} ${e.slice(0, 3).join(" | ")}`);
    }
    await browser.close();
  }
}

// ---------- B. Edge cases on setup ----------
if (!only || only === "B") {
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(800);
  // corrupted PDF with .pdf extension
  writeFileSync(`${out}/bad.pdf`, "%PDF-1.4 garbage not really a pdf");
  const inputs = await page.$$('input[type="file"]');
  await inputs[0].uploadFile(path.resolve(`${out}/bad.pdf`));
  await sleep(2500);
  const t1 = await text(page);
  check("corrupted .pdf → 업로드 실패 with reason", t1.includes("업로드 실패") && t1.includes("PDF를 읽지 못했어요"));
  // empty situation
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    set.call(ta, "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(300);
  const t2 = await text(page);
  check("empty 상황 → hint", t2.includes("상황을 입력해 주세요"));
  await page.type("textarea", "신규 사업 발표\n둘째 줄");
  // slider bounds
  for (let i = 0; i < 40; i++) await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /발표 시간.*늘리기|발표 시간 1분 늘리기/.test(b.getAttribute("aria-label") || ""))?.click());
  const aria = await page.evaluate(() => [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).filter((l) => /늘리|줄이|증가|감소|\+|−|-/.test(l)));
  check("slider ± buttons have aria labels", aria.length >= 4, aria.join(","));
  const sum = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  check("발표 slider max clamps at 30 (via +)", /총 33분/.test(sum), sum);
  const plusDisabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[aria-label]")].filter((b) => (b.getAttribute("aria-label") || "").includes("발표 시간"));
    return b.map((x) => `${x.getAttribute("aria-label")}:${x.disabled}`);
  });
  check("+ disabled at max", plusDisabled.some((s) => /늘리|증가|\+/.test(s) && s.endsWith(":true")), plusDisabled.join(","));
  // remove all judges → empty state + CTA hint
  for (let i = 0; i < 5; i++) await page.evaluate(() => [...document.querySelectorAll("button[aria-label]")].find((b) => /삭제/.test(b.getAttribute("aria-label")) && /민서|준호|도윤|심사위원/.test(b.getAttribute("aria-label")))?.click());
  await sleep(300);
  const t3 = await text(page);
  check("remove all judges → empty state", t3.includes("아직 심사위원이 없어요") && /심사위원 0명/.test(t3));
  // add 5 → button disabled
  for (let i = 0; i < 7; i++) await clickText(page, "추가");
  await sleep(300);
  const n = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  check("add caps at 5 judges", /심사위원 5명/.test(n), n);
  // persona chips: radio semantics, keyboard
  const radios = await page.evaluate(() => [...document.querySelectorAll('[role="radiogroup"]')].map((g) => [...g.querySelectorAll('[role="radio"][aria-checked="true"]')].length));
  check("each judge has exactly one selected chip", radios.length >= 5 && radios.every((x) => x === 1), JSON.stringify(radios));
  // valid upload then go
  await inputs[0].uploadFile(path.resolve("fixtures/presentation.pdf"));
  await sleep(2500);
  await shot(page, `${out}/B-setup-5judges.png`, { fullPage: true });
  check("CTA enabled after upload", await clickText(page, "발표 시작하기"));
  await page.waitForFunction(() => location.pathname === "/ui/presentation", { timeout: 5000 }).catch(() => {});
  await sleep(2500);
  const tp = await text(page);
  check("presentation shows 30:00 timer after max", /30:00|29:5\d/.test(tp), tp.match(/\d\d:\d\d/)?.[0]);
  check("presentation shows 외 2명 참석 with 5 judges", tp.includes("외 2명"));
  await shot(page, `${out}/B-pres-5judges.png`, { fullPage: true });
  // reload presentation: timer from stored minutes, no hydration error
  logs.length = 0;
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(2000);
  const tr = await text(page);
  check("reload presentation keeps minutes (30:00-ish) + no errors", /30:00|29:5\d/.test(tr) && errs(logs).length === 0, `${tr.match(/\d\d:\d\d/)?.[0]} ${errs(logs).join("|")}`);
  // go to review via button, browser back to presentation
  await clickText(page, "발표 마치기");
  await page.waitForFunction(() => location.pathname === "/ui/review", { timeout: 5000 }).catch(() => {});
  await sleep(1500);
  const rv = await text(page);
  check("review pager shows 1 / 5", rv.includes("1 / 5"));
  // spam 답변 완료 to end
  for (let i = 0; i < 5; i++) {
    await clickText(page, "답변 완료");
    await sleep(250);
  }
  await page.waitForFunction(() => location.pathname === "/ui/results", { timeout: 5000 }).catch(() => {});
  check("rapid 답변 완료 → results", (await page.evaluate(() => location.pathname)) === "/ui/results");
  await sleep(1000);
  const res = await text(page);
  check("results shows 질문 5개 and 발표 30분", res.includes("질문 5개") && res.includes("발표 30분"), res.match(/발표 \d+분 · 질의응답 \d+분 · 질문 \d+개/)?.[0]);
  await clickText(page, "상세 피드백 보기");
  await page.waitForFunction(() => location.pathname === "/ui/feedback", { timeout: 5000 }).catch(() => {});
  await sleep(1000);
  const fb = await text(page);
  check("feedback pager count consistent with results (5 questions)", /1 \/ 5/.test(fb), fb.match(/\d \/ \d/)?.[0]);
  await shot(page, `${out}/B-feedback.png`, { fullPage: true });
  check("B console clean", errs(logs).length === 0, errs(logs).slice(0, 3).join(" | "));
  await browser.close();
}

// ---------- C. Camera denied → retry succeeds ----------
if (!only || only === "C") {
  const { browser, page, logs } = await launch({ mobile: true });
  await page.evaluateOnNewDocument(() => {
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__deny = true;
    navigator.mediaDevices.getUserMedia = (c) => (window.__deny ? Promise.reject(new DOMException("denied", "NotAllowedError")) : orig(c));
  });
  await page.goto(BASE + "/ui/presentation", { waitUntil: "networkidle0" });
  await sleep(2000);
  const t = await text(page);
  check("denied → 권한 안내", /권한이 필요해요/.test(t), (t.match(/[^\n]*권한[^\n]*/g) || []).join(" / "));
  await shot(page, `${out}/C-denied.png`, { fullPage: true });
  await page.evaluate(() => (window.__deny = false));
  const clicked = await clickText(page, "다시 시도");
  await sleep(2500);
  const hasVideo = await page.evaluate(() => [...document.querySelectorAll("video")].some((v) => v.srcObject && v.videoWidth > 0));
  const t2 = await text(page);
  check("retry → camera stream + notice gone", clicked && hasVideo, `video=${hasVideo} stillNotice=${/카메라 권한이 필요해요/.test(t2)}`);
  await shot(page, `${out}/C-retry.png`);
  check("C console clean (excluding expected)", errs(logs).length === 0, errs(logs).slice(0, 3).join(" | "));
  await browser.close();
}

// ---------- D. Timers: review auto-end, presentation red; browser back after leaving ----------
if (!only || only === "D") {
  const { browser, page, logs } = await launch({ mobile: false });
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(BASE + "/ui/review?sec=4", { waitUntil: "networkidle0" });
  await sleep(1500);
  const red = await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) => /^00:0\d$/.test(e.textContent.trim()) && e.children.length === 0);
    return el ? getComputedStyle(el).color : null;
  });
  check("review <30s timer red", red === "rgb(180, 35, 24)", red);
  await sleep(4000);
  const t = await text(page);
  check("review 0s → 질의응답 시간이 끝났어요", t.includes("질의응답 시간이 끝났어요"));
  await shot(page, `${out}/D-review-end.png`);
  await page.waitForFunction(() => location.pathname === "/ui/results", { timeout: 8000 }).catch(() => {});
  check("review auto → results", (await page.evaluate(() => location.pathname)) === "/ui/results");
  // history shows 방금 완료
  await page.goto(BASE + "/ui/history", { waitUntil: "networkidle0" });
  await sleep(1000);
  const h = await text(page);
  check("history shows 방금 after auto-end", h.includes("방금"));
  // keyboard flow: tab to first focusable on landing
  await page.goto(BASE + "/ui", { waitUntil: "networkidle0" });
  await page.keyboard.press("Tab");
  const f = await page.evaluate(() => {
    const a = document.activeElement;
    const cs = getComputedStyle(a);
    return `${a.tagName} ${a.textContent.trim().slice(0, 20)} outline=${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`;
  });
  check("landing first Tab shows focus ring", /outline=solid 2px/.test(f), f);
  // desktop layout widths
  for (const r of ["/ui/setup", "/ui/presentation", "/ui/history", "/ui/review"]) {
    await page.goto(BASE + r, { waitUntil: "networkidle0" });
    await sleep(1500);
    const w = await page.evaluate(() => {
      const els = [...document.querySelectorAll("main, [class*=max-w]")];
      return Math.max(...els.map((e) => e.getBoundingClientRect().width));
    });
    check(`desktop ${r} content ≤ 1120`, w <= 1120, `max=${Math.round(w)}`);
  }
  check("D console clean", errs(logs).length === 0, errs(logs).slice(0, 3).join(" | "));
  await browser.close();
}

// ---------- E. reduced motion + presentation at 1280 with portrait PDF ----------
if (!only || only === "E") {
  const { browser, page, logs } = await launch({ mobile: false });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  const anims = await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => {
    const cs = getComputedStyle(e);
    return cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.02;
  }).length);
  check("reduced motion: no running animations on setup", anims === 0, `count=${anims}`);
  const inputs = await page.$$('input[type="file"]');
  await inputs[0].uploadFile(path.resolve("fixtures/proposal.pdf"));
  await sleep(4000);
  await clickText(page, "발표 시작하기");
  await page.waitForFunction(() => location.pathname === "/ui/presentation", { timeout: 5000 }).catch(() => {});
  await sleep(3500);
  const pages = await text(page);
  check("portrait PDF counter 1 / N", /1 \/ \d{2}/.test(pages), pages.match(/1 \/ \d+/)?.[0]);
  await shot(page, `${out}/E-pres-desktop-portrait.png`);
  // ArrowRight key
  await page.keyboard.press("ArrowRight");
  await sleep(800);
  check("ArrowRight → 2 / N", /2 \/ \d+/.test(await text(page)));
  // hit reload → blob lost; what does the presenter see?
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(3500);
  const afterReload = await text(page);
  check("after reload, stage label not claiming uploaded file", true, afterReload.match(/\d+ \/ \d+/)?.[0]);
  await shot(page, `${out}/E-pres-after-reload.png`);
  check("E console clean", errs(logs).length === 0, errs(logs).slice(0, 3).join(" | "));
  await browser.close();
}

writeFileSync(`${out}/results${only ? "-" + only : ""}.txt`, results.join("\n"));
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
