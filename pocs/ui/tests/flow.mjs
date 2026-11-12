// Full click-through of the UI PoC in headless Chrome (mobile 390x844).
// Run from pocs/: node ui/tests/flow.mjs
import { launch, shot, BASE } from "../../scripts/browser.mjs";
import path from "node:path";

const out = ".verify/ui/flow";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);
async function clickText(page, label, sel = "button, a") {
  const handle = await page.evaluateHandle(
    (label, sel) => [...document.querySelectorAll(sel)].find((el) => el.textContent.replace(/\s+/g, " ").trim().includes(label) && el.offsetParent !== null),
    label,
    sel,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`no clickable "${label}" on ${await page.evaluate(() => location.pathname)}`);
  await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await el.click();
}
async function clickSel(page, sel) {
  const el = await page.waitForSelector(sel, { visible: true, timeout: 5000 });
  await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
  await el.click();
}
async function waitText(page, t, timeout = 8000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
}

const { browser, page, logs } = await launch({ mobile: true });
try {
  // 01 랜딩
  await page.goto(`${BASE}/ui`, { waitUntil: "networkidle0" });
  ok("랜딩: 헤드라인", (await text(page)).includes("실전처럼 연습하고,"));
  await clickText(page, "시작하기");
  await page.waitForFunction(() => location.pathname === "/ui/setup");
  await waitText(page, "어떤 발표를");
  ok("랜딩 → 설정 이동", true);

  // 02 설정 — CTA disabled until 발표 자료
  const disabled = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("발표 시작하기")).every((b) => b.disabled));
  ok("설정: 발표 자료 없으면 시작 비활성", disabled);

  // sliders via +/- buttons
  await clickSel(page, 'button[aria-label="발표 시간 1분 늘리기"]');
  await clickSel(page, 'button[aria-label="발표 시간 1분 늘리기"]');
  await clickSel(page, 'button[aria-label="질의응답 시간 1분 줄이기"]');
  let summary = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  ok("설정: 슬라이더 +/- → 총 시간 반영", summary.includes("총 9분"), summary);
  // keyboard on range
  const range = (await page.$$('input[type="range"]'))[0];
  await range.focus();
  await page.keyboard.press("ArrowLeft");
  summary = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  ok("설정: 슬라이더 키보드 조작", summary.includes("총 8분"), summary);

  // upload error state (non-PDF)
  const inputs = await page.$$('input[type="file"]');
  await inputs[0].uploadFile(path.resolve(".verify/ui/not-a-pdf.txt"));
  await waitText(page, "업로드 실패");
  await shot(page, `${out}/02-upload-error.png`);
  ok("설정: 업로드 실패 상태 + 다시 시도", (await text(page)).includes("다시 시도"));

  // upload real PDF (fixtures/presentation.pdf)
  await inputs[0].uploadFile(path.resolve("fixtures/presentation.pdf"));
  await waitText(page, "업로드 중");
  await shot(page, `${out}/02-uploading.png`);
  ok("설정: 업로드 중 진행 표시", true);
  await waitText(page, "페이지 ·", 10000);
  const t2 = await text(page);
  const pages = t2.match(/(\d+)페이지 ·/)?.[1];
  ok("설정: 업로드 완료 — 파일명 + 페이지 수(pdfjs)", t2.includes("presentation.pdf") && Number(pages) > 0, `${pages}페이지`);

  // proposal via sample
  await clickText(page, "샘플 자료 사용");
  await waitText(page, "proposal.pdf", 10000).catch(() => {});
  ok("설정: 제안 자료 샘플 업로드", (await text(page)).includes("proposal") || (await text(page)).includes("제안서"));

  // remove + re-add proposal
  await clickSel(page, 'button[aria-label="제안 자료 삭제"]');
  ok("설정: 제안 자료 삭제 → 빈 상태", (await text(page)).includes("PDF 업로드 (선택)"));

  // judges add/remove + persona
  await clickText(page, "추가");
  summary = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  ok("설정: 심사위원 추가 → 4명", summary.includes("심사위원 4명"), summary);
  await clickSel(page, 'button[aria-label="서연 심사위원 삭제"]');
  summary = await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent);
  ok("설정: 심사위원 삭제 → 3명", summary.includes("심사위원 3명"), summary);
  await clickSel(page, '[aria-label="민서 성향"] [role="radio"]:nth-child(3)');
  const sel = await page.$eval('[aria-label="민서 성향"] [aria-checked="true"]', (e) => e.textContent);
  ok("설정: 성향 단일 선택 (민서 → 공격적)", sel === "공격적", sel);
  await clickSel(page, '[aria-label="민서 성향"] [role="radio"]:nth-child(1)');
  await shot(page, `${out}/02-setup-ready.png`, { fullPage: true });

  await clickText(page, "발표 시작하기");
  await page.waitForFunction(() => location.pathname === "/ui/presentation");
  ok("설정 → 발표 이동", true);

  // 03 발표
  await page.waitForSelector('[data-testid="timer"]');
  const t0 = await page.$eval('[data-testid="timer"]', (e) => e.textContent);
  await sleep(2300);
  const t1 = await page.$eval('[data-testid="timer"]', (e) => e.textContent);
  ok("발표: 타이머 카운트다운 (6분 설정)", t0 !== t1 && t0.startsWith("0"), `${t0} → ${t1}`);
  await page.waitForFunction(() => document.querySelector('[data-testid="slide-counter"]')?.textContent.includes("/ 12"), { timeout: 10000 });
  ok("발표: 업로드 PDF 렌더 + 페이지 수", (await text(page)).includes("업로드 PDF"));
  await clickSel(page, 'button[aria-label="다음 슬라이드"]');
  await clickSel(page, 'button[aria-label="다음 슬라이드"]');
  let counter = await page.$eval('[data-testid="slide-counter"]', (e) => e.textContent);
  ok("발표: 다음 버튼 → 3 / 12", counter === "3 / 12", counter);
  // swipe left on the stage
  const box = await (await page.$('[aria-roledescription="슬라이드"]')).boundingBox();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  counter = await page.$eval('[data-testid="slide-counter"]', (e) => e.textContent);
  ok("발표: 스와이프 → 4 / 12", counter === "4 / 12", counter);
  const camLive = await page.evaluate(() => [...document.querySelectorAll("video")].some((v) => v.srcObject && !v.classList.contains("hidden")));
  ok("발표: getUserMedia 카메라 표시", camLive);
  await waitText(page, "인식 완료", 12000);
  ok("발표: 전사 말풍선 음성 인식 중 → 인식 완료", true);
  await shot(page, `${out}/03-presentation.png`);
  await clickSel(page, 'button[aria-label="슬라이드 크게 보기"]');
  await sleep(500);
  await shot(page, `${out}/03-fullscreen.png`);
  ok("발표: 크게 보기 다이얼로그", !!(await page.$('[role="dialog"][aria-label="슬라이드 크게 보기"]')));
  await page.keyboard.press("Escape");
  await clickText(page, "마이크 켜짐");
  ok("발표: 마이크 토글 → 꺼짐", (await text(page)).includes("마이크 꺼짐"));
  await clickText(page, "카메라 켜짐");
  ok("발표: 카메라 토글 → 꺼짐", (await text(page)).includes("카메라 꺼짐"));
  await clickText(page, "마이크 꺼짐", "button[aria-pressed]");
  await clickText(page, "카메라 꺼짐", "button[aria-pressed]");
  await clickText(page, "발표 마치기");
  await page.waitForFunction(() => location.pathname === "/ui/review");
  ok("발표 → 심사 이동", true);

  // 04 심사
  await waitText(page, "1 / 4");
  await waitText(page, "내 답변", 10000);
  await sleep(1500);
  await shot(page, `${out}/04-review-q1.png`);
  const firstJudge = await page.$eval("main, body", () => document.querySelector('img[alt$="심사위원 얼굴"]')?.alt);
  for (let i = 2; i <= 4; i++) {
    await clickText(page, "답변 완료");
    await waitText(page, `${i} / 4`);
  }
  const lastJudge = await page.evaluate(() => document.querySelector('img[alt$="심사위원 얼굴"]')?.alt);
  ok("심사: 답변 완료 → 다음 심사위원/질문 (4개)", true, `${firstJudge} … ${lastJudge}`);
  await waitText(page, "결과 보기");
  await clickText(page, "답변 완료 · 결과 보기");
  await page.waitForFunction(() => location.pathname === "/ui/results");

  // 05 결과
  ok("결과: 총점 82", (await page.$eval('[data-testid="total-score"]', (e) => e.textContent)) === "82");
  ok("결과: 설정값 반영 (발표 6분 · 질의응답 2분)", (await text(page)).includes("발표 6분 · 질의응답 2분"));
  await clickText(page, "상세 피드백 보기");
  await page.waitForFunction(() => location.pathname === "/ui/feedback");

  // 06 피드백
  await waitText(page, "이렇게 답해 보세요");
  await clickText(page, "다음 질문 보기");
  await waitText(page, "질문 02").catch(() => {});
  const pill = await page.evaluate(() => document.querySelector('[aria-label^="질문 "]')?.textContent);
  ok("피드백: 페이저 → 2 / 4", pill === "2 / 4" && (await text(page)).includes("질문 02"), pill);
  await shot(page, `${out}/06-feedback-q2.png`);
  await clickText(page, "발표 분석", '[role="tab"]');
  await waitText(page, "말 속도");
  ok("피드백: 발표 분석 탭", true);
  await shot(page, `${out}/06-analysis.png`, { fullPage: true });
  await clickText(page, "기록으로 돌아가기");
  await page.waitForFunction(() => location.pathname === "/ui/history");

  // 07 목록
  await waitText(page, "방금");
  ok("목록: 방금 완료한 기록 추가", true);
  const count = () => page.$$eval('[data-testid="history-list"] > li', (l) => l.length);
  const all = await count();
  await clickText(page, "진행 중", '[role="radio"]');
  const prog = await count();
  await clickText(page, "완료", '[role="radio"]');
  const done = await count();
  ok("목록: 필터 전체/완료/진행 중", all === prog + done && prog >= 1 && done >= 1, `전체 ${all} = 완료 ${done} + 진행 중 ${prog}`);
  await clickText(page, "전체", '[role="radio"]');
  await clickText(page, "다시 시작하기");
  await page.waitForFunction(() => location.pathname === "/ui/setup");
  ok("목록: 다시 시작하기 → 설정", true);
  await page.goto(`${BASE}/ui`, { waitUntil: "networkidle0" });
  await clickText(page, "기록");
  await page.waitForFunction(() => location.pathname === "/ui/history");
  ok("랜딩: 기록 버튼 → 목록", true);
  await clickText(page, "새 시뮬레이션");
  await page.waitForFunction(() => location.pathname === "/ui/setup");
  ok("목록: + 새 시뮬레이션 → 설정 (초기화)", (await page.$eval('[data-testid="setup-summary"]', (e) => e.textContent)).includes("총 8분"));

  // auto-transition + red timer
  await page.goto(`${BASE}/ui/presentation?sec=6`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const red = await page.$eval('[data-testid="timer"]', (e) => e.className.includes("text-error"));
  ok("발표: 30초 미만 타이머 빨강 + '곧 종료'", red && (await text(page)).includes("곧 종료"));
  await waitText(page, "발표 시간이 끝났어요", 10000);
  await sleep(400);
  await shot(page, `${out}/03-phase-end.png`);
  ok("발표: 0초 → 단계 전환 안내", true);
  await page.waitForFunction(() => location.pathname === "/ui/review", { timeout: 10000 });
  ok("발표: 안내 후 심사로 자동 이동", true);

  // 종료 dialog
  await clickText(page, "종료");
  await waitText(page, "시뮬레이션을 종료할까요?");
  await sleep(400);
  await shot(page, `${out}/04-exit-dialog.png`);
  await clickText(page, "종료하기");
  await page.waitForFunction(() => location.pathname === "/ui/history");
  ok("심사: 종료 → 진행 중 기록 저장 후 목록", (await text(page)).includes("방금"));
} catch (e) {
  ok("flow exception", false, e.message);
  await shot(page, `${out}/error.png`);
}

// camera permission denied (new page with getUserMedia stubbed to reject)
const p2 = await browser.newPage();
await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p2.evaluateOnNewDocument(() => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
});
await p2.goto(`${BASE}/ui/presentation`, { waitUntil: "networkidle0" });
await sleep(1500);
const t = await p2.evaluate(() => document.body.innerText);
ok("발표: 권한 거부 → 안내 + 다시 시도", t.includes("카메라 권한이 필요해요") && t.includes("다시 시도"));
await shot(p2, `${out}/03-permission-denied.png`);

const errs = logs.filter((l) => /\[(error|pageerror)\]/.test(l));
ok("콘솔 에러 없음", errs.length === 0, errs.slice(0, 3).join(" | "));
await Promise.race([browser.close(), sleep(5000)]);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
