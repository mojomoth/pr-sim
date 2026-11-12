// Reviewer (round 1) adversarial checks. Run from pocs/: node ui/tests/review-1.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";

const out = ".verify/ui/review";
const R = [];
const ok = (n, c, x = "") => {
  R.push({ n, c: !!c });
  console.log(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + x : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (p) => p.evaluate(() => document.body.innerText);
async function click(page, label, sel = "button, a") {
  const h = await page.evaluateHandle(
    (l, s) => [...document.querySelectorAll(s)].find((e) => e.textContent.replace(/\s+/g, " ").trim().includes(l) && e.offsetParent !== null),
    label,
    sel,
  );
  const el = h.asElement();
  if (!el) throw new Error(`no "${label}" on ${await page.evaluate(() => location.pathname)}`);
  await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await el.click();
}
const waitText = (p, t, timeout = 8000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
const overflowX = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const routes = ["/ui", "/ui/setup", "/ui/presentation", "/ui/review", "/ui/results", "/ui/feedback", "/ui/history", "/ui/screens"];

// ---------- A. mobile route captures + console ----------
if (!process.env.SKIP_AB) {
  const { browser, page, logs } = await launch({ mobile: true });
  for (const r of routes) {
    await page.goto(BASE + r, { waitUntil: "networkidle0" });
    await sleep(900);
    const name = r === "/ui" ? "landing" : r.slice(4);
    await shot(page, `${out}/m-${name}.png`);
    await shot(page, `${out}/m-${name}-full.png`, { fullPage: true });
    ok(`mobile ${r} no h-overflow`, (await overflowX(page)) <= 0);
  }
  const errs = logs.filter((l) => /error|warn|hydrat/i.test(l));
  ok("mobile routes console clean", errs.length === 0, errs.slice(0, 5).join(" | "));
  await browser.close();
}
// ---------- B. desktop ----------
if (!process.env.SKIP_AB) {
  const { browser, page, logs } = await launch({});
  for (const r of routes) {
    await page.goto(BASE + r, { waitUntil: "networkidle0" });
    await sleep(900);
    const name = r === "/ui" ? "landing" : r.slice(4);
    await shot(page, `${out}/d-${name}.png`);
    ok(`desktop ${r} no h-overflow`, (await overflowX(page)) <= 0);
  }
  const errs = logs.filter((l) => /error|warn|hydrat/i.test(l));
  ok("desktop routes console clean", errs.length === 0, errs.slice(0, 5).join(" | "));
  await browser.close();
}
// ---------- C. setup edge cases ----------
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  // slider bounds
  for (let i = 0; i < 40; i++) await page.click('button[aria-label="발표 시간 1분 늘리기"]').catch(() => {});
  let sum = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  ok("slider clamps at 30", sum.includes("총 33분"), sum);
  for (let i = 0; i < 40; i++) await page.click('button[aria-label="발표 시간 1분 줄이기"]').catch(() => {});
  for (let i = 0; i < 40; i++) await page.click('button[aria-label="질의응답 시간 1분 줄이기"]').catch(() => {});
  sum = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  ok("slider clamps at 1/1", sum.includes("총 2분"), sum);
  // uploads: non-PDF, broken PDF, real PDF
  const inputs = await page.$$('input[type="file"]');
  await inputs[0].uploadFile(path.resolve(`${out}/not.pdf.txt`));
  await sleep(1200);
  let t = await txt(page);
  ok("non-PDF → 업로드 실패", t.includes("업로드 실패") && t.includes("PDF 파일만"));
  await inputs[0].uploadFile(path.resolve(`${out}/broken.pdf`));
  await sleep(2500);
  t = await txt(page);
  ok("broken PDF → 업로드 실패", t.includes("업로드 실패"), t.includes("PDF를 읽지") ? "msg ok" : "");
  await shot(page, `${out}/c-upload-error.png`);
  await inputs[0].uploadFile(path.resolve("fixtures/presentation.pdf"));
  await sleep(250);
  const mid = await txt(page);
  ok("uploading state visible", mid.includes("업로드 중"));
  await sleep(2500);
  t = await txt(page);
  ok("uploaded: name + pages", /presentation\.pdf/.test(t) && /\d+페이지/.test(t), (t.match(/\d+페이지[^\n]*/) || [""])[0]);
  await inputs[1].uploadFile(path.resolve(`${out}/제안서 최종.pdf`));
  await sleep(2500);
  t = await txt(page);
  ok("proposal upload (korean filename)", t.includes("제안서 최종.pdf"), (t.match(/제안서 최종[^\n]*\n[^\n]*/) || [""])[0]);
  await shot(page, `${out}/c-uploaded.png`, { fullPage: true });
  // replace proposal via 교체 → hidden input same element
  // remove proposal
  await page.click('button[aria-label="제안 자료 삭제"]');
  await sleep(300);
  t = await txt(page);
  ok("proposal removed", !t.includes("제안서 최종.pdf"));
  // judges: remove all → CTA disabled + message
  for (const n of ["민서", "준호", "도윤"]) await page.click(`button[aria-label="${n} 심사위원 삭제"]`);
  await sleep(300);
  t = await txt(page);
  ok("0 judges → hint + CTA disabled", t.includes("심사위원을 1명 이상") && (await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("발표 시작하기")).every((b) => b.disabled))));
  for (let i = 0; i < 7; i++) await click(page, "추가").catch(() => {});
  const cnt = await page.$$eval('ul[aria-label="심사위원 목록"] > li', (l) => l.length);
  ok("judge add capped at 5", cnt === 5, `count=${cnt}`);
  // chip single select on first row
  const groups = await page.$$('[role="radiogroup"]');
  const radios = await groups[0].$$('[role="radio"]');
  await radios[2].click();
  const checked = await groups[0].$$eval('[role="radio"]', (rs) => rs.map((r) => r.getAttribute("aria-checked")));
  ok("persona chips single-select", checked.filter((c) => c === "true").length === 1 && checked[2] === "true", checked.join(","));
  // empty situation
  await page.$eval("textarea", (e) => e.scrollIntoView());
  await page.click("textarea", { clickCount: 3 });
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(200);
  t = await txt(page);
  ok("empty situation → hint", t.includes("상황을 입력해 주세요"));
  await shot(page, `${out}/c-setup-edge.png`, { fullPage: true });
  // reload persistence
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(800);
  t = await txt(page);
  const cnt2 = await page.$$eval('ul[aria-label="심사위원 목록"] > li', (l) => l.length);
  ok("reload keeps judges (sessionStorage)", cnt2 === 5, `count=${cnt2}`);
  ok("reload keeps file meta", /presentation\.pdf/.test(t));
  const errs = logs.filter((l) => /error|hydrat/i.test(l));
  ok("setup edge console clean", errs.length === 0, errs.slice(0, 4).join(" | "));
  await browser.close();
}
// ---------- D. camera denied + retry, timer red, auto-transition ----------
{
  const { browser, page, logs } = await launch({ mobile: true });
  await page.evaluateOnNewDocument(() => {
    window.__deny = true;
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (window.__deny ? Promise.reject(new DOMException("denied", "NotAllowedError")) : orig(c));
  });
  await page.goto(BASE + "/ui/presentation?sec=33", { waitUntil: "networkidle0" });
  await sleep(1500);
  let t = await txt(page);
  ok("camera denied notice", t.includes("카메라 권한이 필요해요"));
  ok("mic denied notice", t.includes("마이크 권한이 필요해요"));
  await shot(page, `${out}/d-denied.png`);
  await page.evaluate(() => (window.__deny = false));
  await page.evaluate(() => document.querySelectorAll('[role="alert"] button').forEach((b) => b.click()));
  await sleep(1500);
  t = await txt(page);
  ok("retry clears notice", !t.includes("권한이 필요해요"));
  await sleep(4000);
  const timerColor = await page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) => /^00:\d\d$/.test(e.textContent.trim()) && e.children.length === 0);
    return el ? getComputedStyle(el).color + " " + el.textContent : "none";
  });
  ok("timer red <30s", /180, 35, 24/.test(timerColor), timerColor);
  await shot(page, `${out}/d-timer-red.png`);
  await waitText(page, "발표 시간이 끝났어요", 40000);
  await shot(page, `${out}/d-phase-end.png`);
  await page.waitForFunction(() => location.pathname === "/ui/review", { timeout: 10000 });
  ok("auto-transition to review", true);
  // review: rotate questions
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await sleep(900);
    const badge = await page.evaluate(() => [...document.querySelectorAll("span")].map((s) => s.textContent).find((x) => /^(민서|준호|도윤) · /.test(x)));
    seen.push(badge);
    await click(page, "답변 완료");
  }
  ok("4 questions rotate judges", new Set(seen).size === 3, seen.join(" / "));
  await page.waitForFunction(() => location.pathname === "/ui/results", { timeout: 8000 });
  ok("last 답변 완료 → results", true);
  await click(page, "기록으로 돌아가기");
  await page.waitForFunction(() => location.pathname === "/ui/history");
  await sleep(600);
  t = await txt(page);
  ok("history shows 방금", t.includes("방금"));
  await click(page, "진행 중", "button");
  await sleep(300);
  const n1 = await page.$$eval('[data-testid="history-list"] > li', (l) => l.length);
  await click(page, "완료", "button");
  await sleep(300);
  const n2 = await page.$$eval('[data-testid="history-list"] > li', (l) => l.length);
  await click(page, "전체", "button");
  await sleep(300);
  const n3 = await page.$$eval('[data-testid="history-list"] > li', (l) => l.length);
  ok("filters partition", n1 + n2 === n3 && n1 > 0 && n2 > 0, `${n1}+${n2}=${n3}`);
  // 이어하기 on an in-progress record
  await click(page, "이어하기");
  await page.waitForFunction(() => location.pathname === "/ui/presentation", { timeout: 5000 });
  ok("이어하기 → presentation", true);
  const errs = logs.filter((l) => /\[error\]|pageerror|hydrat/i.test(l) && !/NotAllowedError|denied/.test(l));
  ok("session console clean", errs.length === 0, errs.slice(0, 4).join(" | "));
  await browser.close();
}
// ---------- E. desktop flow with uploaded PDF → slide render ----------
{
  const { browser, page, logs } = await launch({});
  await page.goto(BASE + "/ui/setup", { waitUntil: "networkidle0" });
  const inputs = await page.$$('input[type="file"]');
  await inputs[0].uploadFile(path.resolve("fixtures/proposal.pdf"));
  await sleep(3000);
  await shot(page, `${out}/e-setup-desktop-uploaded.png`);
  const cols = await page.evaluate(() => {
    const a = document.querySelector('aside[aria-label="설정 요약"]');
    return a ? getComputedStyle(a).display + " " + Math.round(a.getBoundingClientRect().left) : "none";
  });
  ok("desktop setup summary column", /flex \d{3,}/.test(cols), cols);
  await click(page, "발표 시작하기");
  await page.waitForFunction(() => location.pathname === "/ui/presentation");
  await sleep(3000);
  const label = await txt(page);
  ok("uploaded PDF used on stage", label.includes("업로드 PDF"));
  const counter = await page.$eval('[data-testid="slide-counter"]', (e) => e.textContent);
  ok("counter from uploaded PDF pages", /^1 \/ \d+$/.test(counter), counter);
  await page.click('button[aria-label="다음 슬라이드"]');
  await sleep(800);
  await shot(page, `${out}/e-presentation-desktop.png`);
  await page.click('button[aria-label="슬라이드 크게 보기"]');
  await sleep(800);
  await shot(page, `${out}/e-fullscreen.png`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await sleep(300);
  const c2 = await page.$eval('[data-testid="slide-counter"]', (e) => e.textContent);
  ok("fullscreen arrow + esc", c2.startsWith("3 /"), c2);
  // canvas rendered non-blank?
  const blank = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return "nocanvas";
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let nonwhite = 0;
    for (let i = 0; i < d.length; i += 400) if (d[i] < 240) nonwhite++;
    return nonwhite;
  });
  ok("pdf canvas has content", typeof blank === "number" && blank > 10, String(blank));
  // 종료 dialog
  await click(page, "종료");
  await sleep(400);
  await shot(page, `${out}/e-exit-dialog.png`);
  await click(page, "종료하기");
  await page.waitForFunction(() => location.pathname === "/ui/history");
  await sleep(500);
  const t = await txt(page);
  ok("종료 → history 진행 중 방금", t.includes("방금"));
  await shot(page, `${out}/e-history-desktop.png`);
  await click(page, "새 시뮬레이션");
  await page.waitForFunction(() => location.pathname === "/ui/setup");
  await sleep(500);
  const t2 = await txt(page);
  ok("새 시뮬레이션 resets files", !t2.includes("proposal.pdf"));
  const errs = logs.filter((l) => /\[error\]|pageerror|hydrat/i.test(l));
  ok("desktop flow console clean", errs.length === 0, errs.slice(0, 4).join(" | "));
  await browser.close();
}
const f = R.filter((r) => !r.c);
console.log(`\n${R.length - f.length}/${R.length} pass`);
if (f.length) console.log("FAILED:", f.map((x) => x.n).join("; "));
