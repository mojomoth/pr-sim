// Deployed-verifier copy of critic2/flow-critic2.mjs. Differences: BASE_URL = deployed HTTPS URL; every /api call is
// timed (request → requestfinished) and its provider/model/usage/degraded parsed from the body (secrets/images stripped);
// run 2 (Q&A) launches WITHOUT --autoplay-policy=no-user-gesture-required so audio/speech must follow the real user tap;
// speech spy also records utterance start/end/error events.
// Run: BASE_URL=https://pr-sim-lake.vercel.app E2E_OUT=<this dir>/run node <this file>
import { join } from "node:path";
import { rmSync } from "node:fs";
import { allResults, APP, AUDIO, bodyText, check, clickText, failures, idbSession, log, OUT, PROFILE, SAMPLES, save, shot, sleep, waitText } from "../../../../tests/e2e/lib.mjs";
import { createRequire } from "node:module";
const puppeteer = createRequire("/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs")("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const calls = []; // {run, url, method, start, ms, status, info}
function parseInfo(url, status, headers, text) {
  const info = { xProvider: headers["x-provider"], xModel: headers["x-model"], xVoice: headers["x-voice"] };
  try {
    if (url.startsWith("/api/stt/token")) { const j = JSON.parse(text); return { ...info, model: j.model, ok: !!j.token }; }
    if (url.startsWith("/api/tts")) { if (status !== 200) info.body = text.slice(0, 300); return info; }
    if (url.startsWith("/api/questions/followup")) { const j = JSON.parse(text); return { ...info, decision: j.decision, usage: j.usage, degraded: j.degraded, latencyMs: j.latencyMs, error: j.error }; }
    const lines = text.trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l.slice(0, 200) }; } });
    if (url.startsWith("/api/judges")) return { ...info, events: lines.map((e) => ({ type: e.type, slot: e.slot, code: e.code, message: e.message, ms: e.ms, img: e.judge ? !!e.judge.image : undefined })) };
    const last = lines.at(-1) ?? {};
    const errs = lines.filter((e) => e.type === "error");
    if (url.startsWith("/api/wiki")) return { ...info, last: last.type, usage: last.usage, ms: last.ms, degraded: last.degraded, pages: last.wiki?.length, errors: errs };
    if (url.startsWith("/api/questions")) return { ...info, last: last.type, usage: last.usage, timings: last.timings, degraded: last.degraded, main: last.main?.length, errors: errs, stages: lines.filter((e) => e.type === "stage").map((e) => e.stage ?? e.name) };
    if (url.startsWith("/api/report")) return { ...info, last: last.type, provider: last.report?.meta?.provider, usage: last.report?.meta?.usage, errors: errs, steps: lines.filter((e) => e.type === "step").map((e) => ({ id: e.id ?? e.step, status: e.status, provider: e.provider, model: e.model, ms: e.ms })) };
    return { ...info, lines: lines.length };
  } catch (e) { return { ...info, parseError: String(e), head: text.slice(0, 200) }; }
}
async function launch({ wav, autoplayFlag = true } = {}, run) {
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--no-first-run", "--no-default-browser-check", "--disable-features=AudioServiceSandbox"];
  if (autoplayFlag) args.push("--autoplay-policy=no-user-gesture-required");
  if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, userDataDir: PROFILE, protocolTimeout: 600_000 });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const logs = [], net = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  const starts = new Map();
  page.on("request", (r) => { if (r.url().includes("/api/")) starts.set(r, Date.now()); });
  page.on("response", (r) => {
    if (r.url().includes("/api/") || r.status() >= 400) {
      const h = r.headers();
      net.push({ t: Date.now(), url: r.url().replace(APP, ""), status: r.status(), provider: h["x-provider"], model: h["x-model"] });
    }
  });
  const done = async (req, failed) => {
    if (!starts.has(req)) return;
    const start = starts.get(req); starts.delete(req);
    const res = req.response();
    const url = req.url().replace(APP, "");
    let text = "";
    try { text = res ? await res.text() : ""; } catch {}
    calls.push({ run, url, method: req.method(), start: new Date(start).toISOString(), ms: Date.now() - start, status: res?.status() ?? null, failed: failed ? req.failure()?.errorText : undefined, info: res ? parseInfo(url, res.status(), res.headers(), text) : null });
  };
  page.on("requestfinished", (r) => done(r, false));
  page.on("requestfailed", (r) => done(r, true));
  await page.evaluateOnNewDocument(() => {
    window.__audio = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const rec = { at: Date.now() };
      window.__audio.push(rec);
      this.addEventListener("ended", () => (rec.ended = Date.now()), { once: true });
      const p = play.apply(this, arguments);
      p?.catch?.((e) => (rec.err = e?.name));
      return p;
    };
  });
  return { browser, page, logs, net };
}

const parseTimer = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
let sid = "";
const spySpeech = (page) =>
  page.evaluateOnNewDocument(() => {
    window.__speech = [];
    if (!("speechSynthesis" in window)) return;
    const orig = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (u) => {
      const rec = { at: Date.now(), text: u.text, lang: u.lang, voice: u.voice?.name ?? null, rate: u.rate, pitch: u.pitch, volume: u.volume, ua: navigator.userActivation?.hasBeenActive };
      window.__speech.push(rec);
      u.addEventListener("start", () => (rec.started = Date.now()));
      u.addEventListener("end", () => (rec.ended = Date.now()));
      u.addEventListener("error", (e) => (rec.error = e.error));
      return orig(u);
    };
  });

// ── run 1 ──
{
  const { browser, page, logs, net } = await launch({ wav: join(AUDIO, "speech-ko-16k.wav") }, 1);
  await spySpeech(page);
  try {
    await page.goto(APP + "/", { waitUntil: "networkidle2" });
    await shot(page, "01-landing");
    await clickText(page, "a", "시작하기");
    await page.waitForFunction(() => location.pathname === "/setup" && location.search.includes("s="), { timeout: 20_000 });
    sid = new URL(page.url()).searchParams.get("s");
    log("session", sid);

    await page.waitForFunction(() => document.body.innerText.includes("심사위원") && !document.body.innerText.includes("만드는 중"), { timeout: 240_000, polling: 1000 });
    await sleep(1000);
    const faces = await page.$$eval("img", (imgs) => imgs.filter((i) => i.src.startsWith("blob:") && i.naturalWidth > 0).length);
    const faceNote = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /얼굴|첫 글자|실패|쓸 수 없어요|이미지/.test(l)));
    const judgesRes = net.filter((n) => n.url.startsWith("/api/judges"));
    check("setup: 3 faces generated OR initials with a clear notice", faces >= 3 || faceNote.some((l) => /첫 글자/.test(l)), { faces, faceNote, judgesRes });
    await shot(page, "02-setup-judges");

    await (await page.$$("input[type=file]"))[0].uploadFile(join(SAMPLES, "presentation.pdf"));
    await waitText(page, "presentation.pdf", 60_000);
    await page.type("textarea", "친환경 완충재 스타트업의 Pre-A 투자 유치 발표. 투자 심사위원 설득.");
    for (let i = 0; i < 4; i++) await (await page.$("button[aria-label='발표 시간 1분 줄이기']")).click();
    for (let i = 0; i < 2; i++) await (await page.$("button[aria-label='질의응답 시간 1분 줄이기']")).click();
    await sleep(500);
    const footer = await page.evaluate(() => document.body.innerText.match(/총 \d+분 · 심사위원 \d명/)?.[0]);
    check("setup: 1+1 min, 3 judges", footer === "총 2분 · 심사위원 3명", footer);

    const wt0 = Date.now();
    const wikiOk = await page
      .waitForFunction(() => /자료 분석을 마쳤어요/.test(document.body.innerText) || /자료 분석 실패/.test(document.body.innerText), { timeout: 420_000, polling: 2000 })
      .then(() => page.evaluate(() => !/자료 분석 실패/.test(document.body.innerText)));
    const wikiLines = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /자료 분석|모델|경량|대체|Gemini|품질/.test(l)));
    const rec0 = await idbSession(page, sid);
    const d = rec0.docs.presentation;
    const md = (d?.wiki ?? []).map((p) => p.markdown).join("\n");
    const cites = [...md.matchAll(/\(p\.\s*(\d+)(?:\s*[-–,]\s*(\d+))?\)/g)].map((m) => +m[1]);
    const bad = cites.filter((n) => n < 1 || n > d.pageCount);
    check("setup: wiki built via fallback", wikiOk && d?.wikiState === "ready", { secs: Math.round((Date.now() - wt0) / 1000), state: d?.wikiState, err: d?.wikiError, pages: d?.wiki?.length, wikiLines });
    check("setup: wiki has real page citations within 1..pageCount", cites.length >= 5 && bad.length === 0, { n: cites.length, distinct: [...new Set(cites)].sort((a, b) => a - b), bad, pageCount: d?.pageCount });
    save("wiki.json", d?.wiki ?? null);
    check("setup: wiki UI says degraded / which model", wikiLines.some((l) => /경량|대체|Gemini|품질/.test(l)), wikiLines);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "03-setup-ready", true);

    await clickText(page, "button", "발표 시작하기");
    await page.waitForFunction(() => location.pathname === "/present", { timeout: 20_000 });
    await page.waitForSelector("[data-slide-viewer][data-state=ready]", { timeout: 30_000 });
    await clickText(page, "button", "발표 시작");
    const t0 = Date.now();
    await sleep(2500);
    const video = await page.evaluate(() => [...document.querySelectorAll("video")].map((v) => ({ w: v.videoWidth, playing: !v.paused })));
    check("present: camera preview playing", video.some((v) => v.w > 0 && v.playing), video);
    const pg = () => page.$eval("[data-slide-viewer]", (e) => +e.dataset.page);
    await (await page.$("[data-action=next]")).click();
    await sleep(700);
    check("present: slide advance", (await pg()) === 2);
    await shot(page, "04-present-live");
    const timeUp = await page
      .waitForFunction(() => document.body.innerText.includes("발표 시간이 끝났어요"), { timeout: 90_000, polling: 250 })
      .then(() => (Date.now() - t0) / 1000, () => null);
    check("present: time-up dialog at ~60s", timeUp !== null && timeUp < 75, { timeUp });
    await sleep(1500);
    const rec = await idbSession(page, sid);
    check("present: STT transcript saved", rec.transcript.filter((s) => s.phase === "presentation").length > 0, { n: rec.transcript.length, sample: rec.transcript.slice(0, 3).map((s) => s.text) });
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

// ── run 2 ──
const fatal = failures().filter((f) => !/wiki UI says degraded|faces/.test(f.name));
if (sid && !fatal.length) {
  const { browser, page, logs, net } = await launch({ wav: join(AUDIO, "answer-ko-16k.wav"), autoplayFlag: false }, 2);
  await spySpeech(page);
  try {
    await page.goto(`${APP}/qa?s=${sid}`, { waitUntil: "networkidle2" });
    const ready = await page
      .waitForFunction(() => /질문이 준비됐어요|질문을 준비하지 못했어요/.test(document.body.innerText), { timeout: 300_000, polling: 1000 })
      .then(() => page.evaluate(() => document.body.innerText.includes("질문이 준비됐어요")));
    const recQ0 = await idbSession(page, sid);
    const q = recQ0.questions;
    save("questions.json", q ? { items: q.items, order: q.order, main: q.main, reserve: q.reserve } : null);
    check("qa: questions generated", ready && q?.main?.length > 0, { main: q?.main?.length, reserve: q?.reserve?.length });
    const byJudge = {};
    for (const it of q?.items ?? []) (byJudge[it.judgeId] ??= []).push(it.question);
    const texts = (q?.items ?? []).map((i) => i.question);
    check("qa: questions differ by persona (every judge has its own, no duplicates)", Object.keys(byJudge).length === recQ0.judges.length && new Set(texts).size === texts.length, {
      judges: recQ0.judges.map((j) => ({ id: j.id, name: j.name, t: j.temperament, img: !!j.imageKey })),
      byJudge,
    });
    const qaLines = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /모델|경량|대체|Gemini|품질|OpenAI/.test(l)));
    check("qa: questions screen says degraded / which model", qaLines.length > 0, qaLines);
    await shot(page, "06-qa-ready");

    const tapAt = Date.now();
    await clickText(page, "button", "질의응답 시작");
    const t0 = Date.now();
    let answered = 0;
    let noteSeen = null;
    let liteSeen = null;
    while (Date.now() - t0 < 150_000) {
      const st = await page.evaluate(() => ({
        ended: /질의응답 시간이 끝났어요|준비한 질문이 모두 끝났어요/.test(document.body.innerText),
        canSubmit: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("답변 완료") && !b.disabled),
        note: document.body.innerText.split("\n").find((l) => /기기 음성|AI 음성/.test(l)) ?? null,
        lite: document.body.innerText.split("\n").find((l) => /경량|대체 모델/.test(l)) ?? null,
      }));
      noteSeen ??= st.note;
      liteSeen ??= st.lite;
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
    const speech = await page.evaluate(() => window.__speech);
    save("speech-spy.json", { audio, speech });
    const tts = net.filter((n) => n.url.startsWith("/api/tts"));
    check("qa: question spoken (server audio or speechSynthesis.speak called)", audio.length > 0 || speech.filter((s) => s.text.trim()).length > 0, { audio: audio.length, speech: speech.filter((s) => s.text.trim()).slice(0, 3), tts });
    check("qa: first question voiced after the user's tap (no autoplay flag): audio played or an utterance started", (audio ?? []).some((a) => a.at >= tapAt && !a.err) || speech.some((s) => s.text.trim() && s.at >= tapAt && (s.started || s.ended)), { tapAt, audio, speech: speech.map((s) => ({ ...s, text: s.text.slice(0, 40) })) });
    check("qa: degraded-model note visible during Q&A", !!liteSeen || qaLines.length > 0, { liteSeen });
    check("qa: honest device-voice note when /api/tts failed", tts.every((t) => t.status === 200) || !!noteSeen, { noteSeen });
    await shot(page, "08-qa-end");
    const recQ = await idbSession(page, sid);
    save("qa.json", recQ.qa);
    check("qa: answers collected", recQ.qa.length > 0 && recQ.qa.some((x) => x.answer.trim()), { qa: recQ.qa.length, answered, sample: recQ.qa.map((x) => ({ j: x.judge, q: x.question.slice(0, 60), a: x.answer.slice(0, 60), ids: x.answerSentenceIds?.length })) });

    await clickText(page, "a, button", "결과 보기");
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 20_000 });
    const rt0 = Date.now();
    // (flow.mjs races here: the body is still empty right after navigation, so "not 정리하고 있어요" passes at once)
    let reportDone = false;
    while (Date.now() - rt0 < 600_000) {
      if ((await idbSession(page, sid).catch(() => null))?.report) { reportDone = true; break; }
      const t = await bodyText(page).catch(() => "");
      if (t.length > 50 && !/결과를 정리하고 있어요/.test(t)) break; // error / partial screen
      await sleep(3000);
    }
    const recR = await idbSession(page, sid);
    save("report.json", recR.report ?? null);
    save("session-transcript.json", recR.transcript);
    check("result: report generated and stored", reportDone, { secs: Math.round((Date.now() - rt0) / 1000), err: await page.evaluate(() => document.body.innerText.slice(0, 400)) });
    await sleep(1500);
    await shot(page, "09-result-summary", true);
    const provLines = await page.evaluate(() => document.body.innerText.split("\n").filter((l) => /평가 모델|경량|대체 모델|OpenAI|Google|Anthropic/.test(l)));
    check("result: actual provider shown", provLines.some((l) => /평가 모델/.test(l)), { provLines, meta: recR.report?.meta?.provider, byModel: recR.report?.meta?.usage?.byModel });

    const openCite = async (re) => {
      const h = await page.evaluateHandle(
        (src) => [...document.querySelectorAll("button[aria-label]")].find((b) => new RegExp(src).test(b.getAttribute("aria-label")) && b.checkVisibility()),
        re,
      );
      const el = h.asElement();
      if (!el) return null;
      const label = await el.evaluate((b) => (b.scrollIntoView({ block: "center" }), b.getAttribute("aria-label")));
      await el.click();
      const opened = await page
        .waitForFunction(() => [...document.querySelectorAll("[role=dialog]")].some((d) => d.checkVisibility()), { timeout: 10_000 })
        .then(() => true, () => false);
      await sleep(2000);
      const content = await page.evaluate(() => [...document.querySelectorAll("[role=dialog]")].filter((d) => d.checkVisibility()).map((d) => d.innerText.slice(0, 300)).join(" | "));
      const canvas = await page.evaluate(() => [...document.querySelectorAll("[role=dialog] canvas, [role=dialog] img")].filter((c) => c.checkVisibility()).length);
      return { label, opened, content, canvas };
    };
    const summaryLabels = await page.evaluate(() => [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).filter((l) => /보기/.test(l)));
    save("cite-labels-summary.json", summaryLabels);
    await (await page.$("a[href*='tab=feedback']")).click();
    await page.waitForFunction(() => location.search.includes("tab=feedback"), { timeout: 15_000 });
    await sleep(2000);
    check("result: feedback tab shows the Q&A", (await bodyText(page)).length > 200);
    const labels = await page.evaluate(() => [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).filter((l) => /보기/.test(l)));
    save("cite-labels-feedback.json", labels);
    const pc = await openCite("쪽 보기");
    check("result: page citation opens the PDF page", pc?.opened && pc.canvas > 0, pc);
    await shot(page, "10-result-cite-page");
    await page.keyboard.press("Escape");
    await sleep(600);
    const uc = await openCite("발화 보기|답변 원문 보기");
    check("result: utterance citation opens the transcript", uc?.opened && uc.content.length > 10, uc);
    await shot(page, "10b-result-cite-utterance");
    await page.keyboard.press("Escape");
    await sleep(600);
    await shot(page, "11-result-feedback", true);

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
    check("run 2 finished without exceptions", false, String(e?.message ?? e));
    await shot(page, "run2-error").catch(() => {});
  } finally {
    save("run2-console.log", logs.join("\n"));
    save("run2-net.json", net);
    await browser.close();
  }
}

save("api-calls.json", calls);
save("results.json", { sid, base: APP, results: allResults() });
log("profile kept", PROFILE);
const failed = failures();
log(failed.length ? `FAILED ${failed.length}/${allResults().length} → ${OUT}` : `ALL ${allResults().length} CHECKS PASSED → ${OUT}`);
process.exit(failed.length ? 1 : 0);
