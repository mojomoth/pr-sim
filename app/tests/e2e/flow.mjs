// Full-flow browser E2E with the real APIs (judges, wiki, questions, TTS/STT, report): about 8–10 minutes.
// Needs the app server running (BASE_URL, default http://localhost:3000) and Chrome (CHROME_PATH).
//   landing → setup (bad uploads rejected, 2 PDFs, 3 judges, 1+1 min) → presentation (timer, slides, camera, STT,
//   auto-advance) → Q&A (questions, TTS, spoken answer) → result (report, citation sheet, feedback tab)
//   → history (listed after reload, reopen without a new report call).
// Screenshots, logs and a results.json go to .verify/e2e/<timestamp>/ (E2E_OUT overrides). Exit code 1 on any failed check.
import { closeSync, copyFileSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { allResults, APP, AUDIO, bodyText, check, clickText, failures, idbSession, launch, log, OUT, PROFILE, SAMPLES, save, shot, sleep, waitText } from "./lib.mjs";

// Upload fixtures that must be rejected: an image renamed .pdf, a PDF header with garbage, and a 31MB file.
const FX = `${PROFILE}-fx`;
mkdirSync(FX, { recursive: true });
copyFileSync(join(SAMPLES, "../landing/hero-stage-mobile-v2.webp"), join(FX, "notpdf.pdf"));
writeFileSync(join(FX, "corrupt.pdf"), Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(Array.from({ length: 20_000 }, (_, i) => (i * 7919) % 256))]));
{
  const fd = openSync(join(FX, "big31mb.pdf"), "w");
  writeSync(fd, "%PDF-1.7\n");
  writeSync(fd, Buffer.alloc(1), 0, 1, 31 * 1024 * 1024);
  closeSync(fd);
}

const parseTimer = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
let sid = "";
let presented = false; // run 1 got the session to the presentation screen (run 2 can continue it)

// ── run 1: setup + presentation (mic = scripted pitch) ──
{
  const { browser, page, logs, net } = await launch({ wav: join(AUDIO, "speech-ko-16k.wav") });
  try {
    await page.goto(APP + "/", { waitUntil: "networkidle2" });
    await shot(page, "01-landing");
    await clickText(page, "a", "시작하기");
    await page.waitForFunction(() => location.pathname === "/setup" && location.search.includes("s="), { timeout: 20_000 });
    sid = new URL(page.url()).searchParams.get("s");
    log("session", sid);

    await page.waitForFunction(() => document.body.innerText.includes("심사위원") && !document.body.innerText.includes("만드는 중"), { timeout: 180_000, polling: 1000 });
    const faces = await page.$$eval("img", (imgs) => imgs.filter((i) => i.src.startsWith("blob:") && i.naturalWidth > 0).length);
    check("setup: 3 judge faces generated", faces >= 3, { faces, note: await page.evaluate(() => document.body.innerText.match(/[^\n]*(실패|쓸 수 없어요)[^\n]*/)?.[0]) });
    await shot(page, "02-setup-judges");

    const upload = async (file, idx = 0) => (await page.$$("input[type=file]"))[idx].uploadFile(file);
    for (const bad of ["notpdf", "corrupt", "big31mb"]) {
      await upload(join(FX, `${bad}.pdf`));
      const shown = await page
        .waitForFunction(() => /업로드 실패|교체 실패/.test(document.body.innerText), { timeout: 30_000, polling: 200 })
        .then(() => true, () => false);
      const msg = await page.evaluate(() => [...document.querySelectorAll("[role=alert]")].map((e) => e.innerText.replace(/\s+/g, " ")).join(" | "));
      check(`setup: ${bad} upload rejected with a message`, shown && msg.length > 5, msg);
      await (await page.$("button[aria-label='오류 닫기']"))?.click();
      await sleep(300);
    }
    await upload(join(SAMPLES, "presentation.pdf"), 0);
    await waitText(page, "presentation.pdf", 60_000);
    await upload(join(SAMPLES, "proposal.pdf"), 1);
    await waitText(page, "proposal.pdf", 60_000);
    check("setup: both PDFs attached", true);

    await page.type("textarea", "친환경 완충재 스타트업의 Pre-A 투자 유치 발표. 투자 심사위원 설득.");
    for (let i = 0; i < 4; i++) await (await page.$("button[aria-label='발표 시간 1분 줄이기']")).click();
    for (let i = 0; i < 2; i++) await (await page.$("button[aria-label='질의응답 시간 1분 줄이기']")).click();
    await sleep(500);
    const footer = await page.evaluate(() => document.body.innerText.match(/총 \d+분 · 심사위원 \d명/)?.[0]);
    check("setup: 1+1 min, 3 judges", footer === "총 2분 · 심사위원 3명", footer);

    const wikiOk = await page
      .waitForFunction(() => (document.body.innerText.match(/자료 분석을 마쳤어요/g) ?? []).length >= 2 || /자료 분석 실패/.test(document.body.innerText), { timeout: 420_000, polling: 2000 })
      .then(() => page.evaluate(() => !/자료 분석 실패/.test(document.body.innerText)));
    const wikiNote = await page.evaluate(() => document.body.innerText.match(/자료 분석 실패[^\n]*\n?[^\n]*/)?.[0]);
    check("setup: wiki built for both documents", wikiOk, wikiNote);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "03-setup-ready");

    await clickText(page, "button", "발표 시작하기");
    await page.waitForFunction(() => location.pathname === "/present", { timeout: 20_000 });
    presented = true;
    await page.waitForSelector("[data-slide-viewer][data-state=ready]", { timeout: 30_000 });
    await clickText(page, "button", "발표 시작");
    const t0 = Date.now();
    await sleep(2500);
    const video = await page.evaluate(() => [...document.querySelectorAll("video")].map((v) => ({ w: v.videoWidth, playing: !v.paused })));
    check("present: camera preview playing", video.some((v) => v.w > 0 && v.playing), video);

    const pg = () => page.$eval("[data-slide-viewer]", (e) => +e.dataset.page);
    const p1 = await pg();
    await (await page.$("[data-action=next]")).click();
    await sleep(700);
    const p2 = await pg();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("ArrowLeft");
    await sleep(700);
    const p3 = await pg();
    check("present: slide next button and arrow key", p1 === 1 && p2 === 2 && p3 === 1, { p1, p2, p3 });
    await shot(page, "04-present-live");

    const a = await page.$eval("[data-testid=timer]", (e) => e.textContent);
    const tA = Date.now();
    await sleep(15_000);
    const b = await page.$eval("[data-testid=timer]", (e) => e.textContent);
    const ticked = parseTimer(a) - parseTimer(b);
    check("present: timer follows the wall clock", Math.abs(ticked - (Date.now() - tA) / 1000) <= 2, { a, b });

    const timeUp = await page
      .waitForFunction(() => document.body.innerText.includes("발표 시간이 끝났어요"), { timeout: 90_000, polling: 250 })
      .then(() => (Date.now() - t0) / 1000, () => null);
    check("present: time-up dialog at ~60s", timeUp !== null && timeUp < 75, { timeUp });
    await sleep(1500);
    const rec = await idbSession(page, sid);
    check("present: STT transcript saved", rec.transcript.filter((s) => s.phase === "presentation").length > 0, { n: rec.transcript.length, status: rec.status });
    await shot(page, "05-present-timeup");
    await clickText(page, "a, button", "질의응답 시작하기");
    await page.waitForFunction(() => location.pathname === "/qa", { timeout: 20_000 });
  } catch (e) {
    check("run 1 finished without exceptions", false, String(e?.message ?? e));
    await shot(page, "run1-error").catch(() => {});
  } finally {
    save("run1-console.log", logs.join("\n"));
    save("run1-net.json", net);
    await browser.close();
  }
}

// ── run 2: Q&A (mic = scripted answer) + result + history ──
// Gated on a usable session only: a provider outage in run 1 (faces, wiki) is a failed check, not a reason to skip Q&A.
if (sid && presented) {
  const { browser, page, logs, net } = await launch({ wav: join(AUDIO, "answer-ko-16k.wav") });
  try {
    await page.goto(`${APP}/qa?s=${sid}`, { waitUntil: "networkidle2" });
    const ready = await page
      .waitForFunction(() => /질문이 준비됐어요|질문을 준비하지 못했어요/.test(document.body.innerText), { timeout: 300_000, polling: 1000 })
      .then(() => page.evaluate(() => document.body.innerText.includes("질문이 준비됐어요")));
    const q = (await idbSession(page, sid)).questions;
    check("qa: questions generated", ready && q?.main?.length > 0, { main: q?.main?.length, reserve: q?.reserve?.length });
    await shot(page, "06-qa-ready");
    // No questions (e.g. every provider down): the failed check above records it; the rest of run 2 cannot proceed.
    if (!ready) throw Object.assign(new Error("questions unavailable"), { skip: true });

    await clickText(page, "button", "질의응답 시작");
    const t0 = Date.now();
    let answered = 0;
    while (Date.now() - t0 < 150_000) {
      const st = await page.evaluate(() => ({
        ended: /질의응답 시간이 끝났어요|준비한 질문이 모두 끝났어요/.test(document.body.innerText),
        canSubmit: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("답변 완료") && !b.disabled),
      }));
      if (st.ended) break;
      if (st.canSubmit) {
        await page
          .waitForFunction(() => {
            const a = [...document.querySelectorAll("p")].find((e) => e.textContent.startsWith("내 답변"))?.parentElement?.innerText ?? "";
            return a.replace(/내 답변|음성 인식 중|연결 중|·|답변을 말씀해 주세요…/g, "").trim().length > 40 || /끝났어요/.test(document.body.innerText);
          }, { timeout: 25_000, polling: 500 })
          .catch(() => {});
        await sleep(2000);
        await shot(page, `07-qa-answer-${answered + 1}`);
        const clicked = await page.evaluate(() => {
          const b = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("답변 완료") && !b.disabled);
          b?.click();
          return !!b;
        });
        if (clicked) answered++;
      }
      await sleep(700);
    }
    const audio = await page.evaluate(() => window.__audio);
    check("qa: judge question spoken (TTS played)", audio.length > 0, { plays: audio.length });
    await shot(page, "08-qa-end");
    const recQ = await idbSession(page, sid);
    check("qa: answer saved with transcript", recQ.qa.length > 0 && recQ.qa.some((x) => x.answer.trim()), { qa: recQ.qa.length, status: recQ.status });

    await clickText(page, "a, button", "결과 보기");
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 20_000 });
    const reportDone = await page
      // Wait for a finished state, not for the loading text to vanish: the body is empty right after navigation.
      .waitForFunction(() => /이번 발표의 종합 점수|결과를 만들지 못했어요/.test(document.body.innerText), { timeout: 600_000, polling: 2000 })
      .then(async () => !!(await idbSession(page, sid)).report, () => false);
    check("result: report generated and stored", reportDone);
    await sleep(1500);
    await shot(page, "09-result-summary");

    const openCite = async () => {
      const h = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button[aria-label]")].find((b) => /쪽 보기|발화 보기|답변 원문 보기/.test(b.getAttribute("aria-label")) && b.checkVisibility()),
      );
      const el = h.asElement();
      if (!el) return null;
      const label = await el.evaluate((b) => (b.scrollIntoView({ block: "center" }), b.getAttribute("aria-label")));
      await el.click();
      const opened = await page
        .waitForFunction(() => [...document.querySelectorAll("[role=dialog]")].some((d) => d.checkVisibility()), { timeout: 10_000 })
        .then(() => true, () => false);
      await sleep(1500);
      return { label, opened };
    };
    const cite = await openCite();
    check("result: citation opens the source sheet", cite?.opened, cite);
    await shot(page, "10-result-cite");
    await page.keyboard.press("Escape");
    await sleep(600);

    await (await page.$("a[href*='tab=feedback']")).click();
    await page.waitForFunction(() => location.search.includes("tab=feedback"), { timeout: 15_000 });
    await sleep(2000);
    check("result: feedback tab shows the Q&A", (await bodyText(page)).length > 200);
    await shot(page, "11-result-feedback");

    await page.goto(`${APP}/history`, { waitUntil: "networkidle2" });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1500);
    const listed = await page.evaluate((sid) => !!document.querySelector(`a[href="/result?s=${sid}"]`), sid);
    check("history: session listed after reload", listed);
    await shot(page, "12-history");
    const before = net.filter((n) => n.url.startsWith("/api/report")).length;
    await (await page.$(`a[href="/result?s=${sid}"]`)).click();
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 15_000 });
    await sleep(3000);
    check("history: reopen shows the stored report (no new /api/report call)", net.filter((n) => n.url.startsWith("/api/report")).length === before);
    await shot(page, "13-history-reopen");
  } catch (e) {
    if (e?.skip) log(`run 2 stopped after Q&A prep: ${e.message} (answer/result/history not checked)`);
    else check("run 2 finished without exceptions", false, String(e?.message ?? e));
    await shot(page, "run2-error").catch(() => {});
  } finally {
    save("run2-console.log", logs.join("\n"));
    save("run2-net.json", net);
    await browser.close();
  }
} else log("run 2 skipped: run 1 did not reach the presentation screen");

save("results.json", { sid, base: APP, results: allResults() });
rmSync(PROFILE, { recursive: true, force: true });
rmSync(FX, { recursive: true, force: true });
const failed = failures();
log(failed.length ? `FAILED ${failed.length}/${allResults().length} → ${OUT}` : `ALL ${allResults().length} CHECKS PASSED → ${OUT}`);
process.exit(failed.length ? 1 : 0);
