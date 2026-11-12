// SCREENS-B end-to-end: /present → /qa with real APIs, headless Chrome 390×844, fake camera + fake mic.
//   node run.mjs present   → seeds a 1-min/1-min session, presents (speech-ko wav), reload/resume, time-up → /qa
//   node run.mjs qa        → loads the session exported by "present" (answer-ko wav), runs Q&A until /result
//   node run.mjs misc      → not-found deep links   (also: layout, qa-resume, desktop; QA_MIN=2 node run.mjs qa)
// Run `node seed-build.mjs` first: it writes seed.json (≈2.4MB, PDFs + judge photos; deleted after runs, not kept in git).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-B";
const BASE = "http://localhost:3000";
const AUDIO = "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio";
const mode = process.argv[2] ?? "present";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function seed(page, session, blobs) {
  await page.evaluate(
    async (session, blobs) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("pr-sim", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("sessions", { keyPath: "id" });
          r.result.createObjectStore("blobs");
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction(["sessions", "blobs"], "readwrite");
      tx.objectStore("sessions").put(session);
      for (const [k, v] of Object.entries(blobs)) {
        const bin = Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0));
        tx.objectStore("blobs").put(new Blob([bin], { type: v.type }), k);
      }
      await new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error))));
      db.close();
    },
    session,
    blobs,
  );
}
async function readSession(page, id) {
  return page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("pr-sim", 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rec = await new Promise((res) => {
      const q = db.transaction("sessions").objectStore("sessions").get(id);
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return rec;
  }, id);
}
const clickText = (page, text) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.replace(/\s+/g, " ").trim().includes(text) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text);
const hasText = (page, text) => page.evaluate((t) => document.body.innerText.includes(t), text);
const timerText = (page) => page.evaluate(() => document.querySelector('[data-testid="timer"]')?.textContent);
const scroller = (page, to) => page.evaluate((to) => { const s = document.getElementById("app-scroll"); s.scrollTop = to === "bottom" ? s.scrollHeight : 0; }, to);
/** Bottom of the last element matching sel vs the top of the fixed bottom bar (scrolled to the end). */
const overlap = (page, sel) =>
  page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].at(-1);
    const bar = document.querySelector(".app-bottom-bar");
    if (!el || !bar) return null;
    const a = el.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return { elTop: Math.round(a.top), elBottom: Math.round(a.bottom), barTop: Math.round(b.top), viewport: innerHeight, hidden: a.bottom > b.top + 0.5 };
  }, sel);

const seedData = JSON.parse(readFileSync(`${OUT}/seed.json`, "utf8"));
const ID = seedData.session.id;

if (mode === "present") {
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: `${AUDIO}/speech-ko-16k.wav` });
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await seed(page, seedData.session, seedData.blobs);
    await page.goto(`${BASE}/present?s=${ID}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await sleep(1500);
    check("present: slide viewer ready with sample deck", (await page.$eval("[data-page-indicator]", (e) => e.textContent)) === "1 / 12");
    check("present: timer shows 01:00 before start", (await timerText(page)) === "01:00", await timerText(page));
    const faces = await page.$$eval('section[aria-label="심사위원"] img', (imgs) => imgs.map((i) => ({ src: i.src.slice(0, 5), ok: i.complete && i.naturalWidth > 0, alt: i.alt })));
    check("present: 3 judge faces from IndexedDB blobs", faces.length === 3 && faces.every((f) => f.src === "blob:" && f.ok), faces);
    const cam = await page.$eval('[aria-label="내 카메라"] video', (v) => ({ hidden: v.classList.contains("hidden"), w: v.videoWidth, mirrored: `${getComputedStyle(v).scale} ${getComputedStyle(v).transform}` }));
    check("present: camera inset live + mirrored", !cam.hidden && cam.w > 0 && /^-1|matrix\(-1/.test(cam.mirrored), cam);
    await shot(page, `${OUT}/present-ready.png`);

    await clickText(page, "발표 시작");
    console.log(ts(), "started");
    await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 20000 }).catch(() => {});
    await sleep(9000);
    await page.click('[data-action="next"]');
    await sleep(400);
    await page.keyboard.press("ArrowRight");
    await sleep(600);
    check("present: next button + ArrowRight → 3 / 12", (await page.$eval("[data-page-indicator]", (e) => e.textContent)) === "3 / 12");
    await sleep(6000);
    const bubble = await page.evaluate(() => document.querySelector("#stt-h")?.parentElement?.parentElement?.innerText);
    check("present: live transcript bubble (내 발표 · 음성 인식 중 / text)", /내 발표/.test(bubble ?? "") && (bubble ?? "").length > 20, bubble);
    await shot(page, `${OUT}/present-live.png`);
    await scroller(page, "bottom");
    await sleep(300);
    const ov = await overlap(page, 'section[aria-label="심사위원"]');
    check("present 390×844: judge row not under the bottom bar (scrolled to end)", ov && !ov.hidden, ov);
    await scroller(page, "top");
    const ovTop = await overlap(page, 'section[aria-label="심사위원"]');
    console.log("judge row at scrollTop 0:", ovTop);
    await shot(page, `${OUT}/present-live-bottom.png`);

    let rec = await readSession(page, ID);
    check("present: sentences persisted incrementally with t + slide", rec.transcript.length > 0 && rec.transcript.every((s) => s.phase === "presentation" && typeof s.t === "number"), rec.transcript.map((s) => ({ t: s.t, slide: s.slide, text: s.text.slice(0, 30) })));
    check("present: resume.remainingSec saved while live", rec.status === "presentation" && rec.resume?.phase === "presentation" && rec.resume.remainingSec < 60, rec.resume);

    // reload mid-presentation → resume
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await sleep(1200);
    const resumeBtn = await hasText(page, "이어서 발표하기");
    const tRes = await timerText(page);
    check("present: reload → 이어서 발표하기 with saved remaining time, slide restored", resumeBtn && tRes !== "01:00", { tRes, page: await page.$eval("[data-page-indicator]", (e) => e.textContent) });
    await shot(page, `${OUT}/present-resume.png`);
    const before = rec.transcript.length;
    await clickText(page, "이어서 발표하기");
    console.log(ts(), "resumed");
    // time up → PhaseEndDialog → auto /qa
    await page.waitForFunction(() => document.body.innerText.includes("발표 시간이 끝났어요"), { timeout: 90000 });
    await sleep(500);
    await shot(page, `${OUT}/present-timeup.png`);
    check("present: time up → 발표 시간이 끝났어요 dialog", true);
    await page.waitForFunction(() => location.pathname === "/qa", { timeout: 15000 });
    check("present: auto-advance to /qa?s=", page.url().includes(`/qa?s=${ID}`), page.url());
    await sleep(1500);
    rec = await readSession(page, ID);
    const ts2 = rec.transcript.map((s) => s.t);
    check("present: transcript continued after resume (t increases)", rec.transcript.length > before && ts2.every((t, i) => i === 0 || t >= ts2[i - 1] - 1.5), { before, after: rec.transcript.length, t: ts2 });
    check("present: status → qa, resume cleared", rec.status === "qa" && !rec.resume, { status: rec.status, resume: rec.resume });
    await shot(page, `${OUT}/qa-preparing.png`);
    writeFileSync(`${OUT}/session-after-present.json`, JSON.stringify(rec));
  } finally {
    writeFileSync(`${OUT}/present-console.log`, logs.join("\n"));
    writeFileSync(`${OUT}/present-results.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }
}

if (mode === "qa") {
  const rec0 = JSON.parse(readFileSync(`${OUT}/session-after-present.json`, "utf8"));
  const tag = process.env.QA_MIN ? `-${process.env.QA_MIN}min` : "";
  if (process.env.QA_MIN) rec0.setup.qaMinutes = Number(process.env.QA_MIN);
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: `${AUDIO}/answer-ko-16k.wav` });
  const net = [];
  page.on("response", (r) => r.url().includes("/api/") && net.push(`${ts()} ${r.status()} ${r.url().replace(BASE, "")} ${r.headers()["x-provider"] ?? ""}`));
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await seed(page, rec0, seedData.blobs);
    await page.goto(`${BASE}/qa?s=${ID}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("질문을 준비하고 있어요"), { timeout: 20000 });
    await sleep(6000);
    await shot(page, `${OUT}/qa${tag}-prep-progress.png`);
    await page.waitForFunction(() => /질문이 준비됐어요|질문을 준비하지 못했어요/.test(document.body.innerText), { timeout: 150000 });
    await shot(page, `${OUT}/qa${tag}-ready.png`);
    let rec = await readSession(page, ID);
    check("qa: POST /api/questions → questions saved (pack, main, reserve)", rec.questions?.main?.length > 0 && rec.questions.pack?.text?.length > 0, { main: rec.questions?.main, reserve: rec.questions?.reserve });
    console.log(ts(), "ready");
    await clickText(page, "질의응답 시작");
    let rounds = 0;
    while (rounds < 6) {
      // wait for listening (after TTS) or the end
      await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중") || location.pathname === "/result" || document.body.innerText.includes("결과 보기"), { timeout: 60000 }).catch(() => {});
      if ((await hasText(page, "결과 보기")) || page.url().includes("/result")) break;
      if (rounds === 0) {
        await sleep(1500);
        const q = await page.evaluate(() => document.body.innerText);
        check("qa: judge question bubble + hero (질문/답변) + answer bubble", /심사위원 질문/.test(q) && /내 답변/.test(q), q.slice(0, 300));
      }
      await sleep(13000);
      await shot(page, `${OUT}/qa${tag}-answer-${rounds + 1}.png`);
      if (rounds === 0) {
        const mic = await page.evaluate(() => {
          const bar = document.querySelector(".app-bottom-bar")?.getBoundingClientRect();
          const row = document.querySelector('[aria-label="마이크 끄기"], [aria-label="마이크 켜기"]')?.parentElement?.getBoundingClientRect();
          return bar && row ? { barTop: Math.round(bar.top), rowTop: Math.round(row.top), rowBottom: Math.round(row.bottom), vh: innerHeight, inBar: row.top >= bar.top && row.bottom <= innerHeight } : null;
        });
        check("qa 390×844: mic/waveform row fully visible (inside the bottom bar)", mic?.inBar, mic);
        await scroller(page, "bottom");
        await sleep(300);
        const ans = await overlap(page, ".scroll-mb-4");
        check("qa 390×844: answer bubble not under the bottom bar (scrolled to end)", ans && !ans.hidden, ans);
      }
      if ((await hasText(page, "결과 보기")) || page.url().includes("/result")) break;
      await clickText(page, "답변 완료");
      console.log(ts(), "answered", rounds + 1);
      rounds++;
      await sleep(1500);
      await shot(page, `${OUT}/qa${tag}-judging-${rounds}.png`);
      await page.waitForFunction(() => !document.body.innerText.includes("답변 확인 중"), { timeout: 70000 }).catch(() => {});
      if (await page.$("details summary")) {
        await page.click("details summary");
        await sleep(400);
        await page.evaluate(() => document.querySelector("details")?.scrollIntoView({ block: "end" }));
        await shot(page, `${OUT}/qa${tag}-log-${rounds}.png`);
        await page.click("details summary");
      }
    }
    await page.waitForFunction(() => document.body.innerText.includes("결과 보기") || location.pathname === "/result", { timeout: 90000 }).catch(() => {});
    await shot(page, `${OUT}/qa${tag}-end.png`);
    check("qa: end dialog (time up / questions done) → 결과 보기", (await hasText(page, "결과 보기")) || page.url().includes("/result"));
    rec = await readSession(page, ID);
    check("qa: QA items recorded (question, answer, answerSentenceIds, evidence, assessment, decision)", rec.qa.length > 0 && rec.qa.some((x) => x.assessment && x.decision && x.answerSentenceIds?.length && Array.isArray(x.evidence)), rec.qa.map((x) => ({ q: x.question.slice(0, 40), a: x.answer.slice(0, 40), ids: x.answerSentenceIds?.length, ev: x.evidence?.length, as: x.assessment?.verdict, d: x.decision, f: x.followup })));
    check("qa: qa-phase transcript sentences persisted", rec.transcript.some((s) => s.phase === "qa"), rec.transcript.filter((s) => s.phase === "qa").length);
    check("qa: status → report, resume cleared", rec.status === "report" && !rec.resume, { status: rec.status, resume: rec.resume });
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 15000 }).catch(() => {});
    check("qa: auto-advance to /result?s=", page.url().includes(`/result?s=${ID}`), page.url());
    writeFileSync(`${OUT}/session-after-qa${tag}.json`, JSON.stringify({ ...rec, questions: { ...rec.questions, pack: { ...rec.questions?.pack, text: `(${rec.questions?.pack?.text?.length} chars)` } } }, null, 1));
  } finally {
    writeFileSync(`${OUT}/qa${tag}-network.log`, net.join("\n"));
    writeFileSync(`${OUT}/qa${tag}-console.log`, logs.join("\n"));
    writeFileSync(`${OUT}/qa${tag}-results.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }
}

if (mode === "layout") {
  const { browser, page } = await launch({ mobile: true, fakeAudioWav: `${AUDIO}/speech-ko-16k.wav` });
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await seed(page, { ...seedData.session, id: "s_layout" }, seedData.blobs);
    await page.goto(`${BASE}/present?s=s_layout&sec=300`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await clickText(page, "발표 시작");
    await sleep(14000);
    console.log("top", await overlap(page, 'section[aria-label="심사위원"]'));
    await shot(page, `${OUT}/layout-present-top.png`);
    await scroller(page, "bottom");
    await sleep(300);
    console.log("bottom", await overlap(page, 'section[aria-label="심사위원"]'));
  } finally {
    await browser.close();
  }
}

if (mode === "qa-resume") {
  // Session left mid-Q&A: 1 answered item, 40 s left → 이어하기 asks the next question; 종료 saves resume again.
  const done = JSON.parse(readFileSync(`${OUT}/session-after-qa-2min.json`, "utf8"));
  const rec0 = { ...done, id: "s_qaresume", status: "qa", qa: done.qa.slice(0, 1), resume: { phase: "qa", remainingSec: 40 } };
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: `${AUDIO}/answer-ko-16k.wav` });
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await seed(page, rec0, seedData.blobs);
    await page.goto(`${BASE}/qa?s=s_qaresume`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("이어서 질의응답하기"), { timeout: 15000 }).catch(() => {});
    check("qa-resume: ready state with 이어서 질의응답하기 and saved time", (await hasText(page, "이어서 질의응답하기")) && (await timerText(page)) === "00:40", await timerText(page));
    await shot(page, `${OUT}/qa-resume-ready.png`);
    await clickText(page, "이어서 질의응답하기");
    await page.waitForFunction(() => document.body.innerText.includes("음성 인식 중"), { timeout: 40000 }).catch(() => {});
    const txt = await page.evaluate(() => document.body.innerText);
    const firstMain = done.qa.filter((x) => !x.followup).map((x) => x.questionId);
    check("qa-resume: continues with the next unanswered main question", /심사위원 질문 · 2 \/ 2/.test(txt), txt.slice(0, 260));
    await shot(page, `${OUT}/qa-resume-asking.png`);
    await clickText(page, "종료");
    await sleep(500);
    await shot(page, `${OUT}/qa-exit-confirm.png`);
    await clickText(page, "종료하기");
    await page.waitForFunction(() => location.pathname === "/history", { timeout: 15000 }).catch(() => {});
    const rec = await readSession(page, "s_qaresume");
    check("qa-resume: 종료 → /history with status qa + resume.remainingSec", page.url().includes("/history") && rec.status === "qa" && rec.resume?.phase === "qa" && rec.resume.remainingSec <= 40, { url: page.url(), status: rec.status, resume: rec.resume, firstMain });
  } finally {
    writeFileSync(`${OUT}/qa-resume-console.log`, logs.join("\n"));
    writeFileSync(`${OUT}/qa-resume-results.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }
}

if (mode === "desktop") {
  // Frame mode (1280×860): both screens inside the phone mockup.
  const { browser, page } = await launch({ mobile: false, fakeAudioWav: `${AUDIO}/speech-ko-16k.wav` });
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const qaDone = JSON.parse(readFileSync(`${OUT}/session-after-qa-2min.json`, "utf8"));
    await seed(page, { ...seedData.session, id: "s_desk" }, seedData.blobs);
    await seed(page, { ...qaDone, id: "s_deskqa", status: "qa", qa: qaDone.qa.slice(0, 1), resume: { phase: "qa", remainingSec: 90 } }, {});
    await page.goto(`${BASE}/present?s=s_desk`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await sleep(1500);
    await shot(page, `${OUT}/desktop-present.png`);
    await page.goto(`${BASE}/qa?s=s_deskqa`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("이어서 질의응답하기"), { timeout: 15000 }).catch(() => {});
    await sleep(800);
    await shot(page, `${OUT}/desktop-qa-ready.png`);
  } finally {
    await browser.close();
  }
}

if (mode === "misc") {
  const { browser, page, logs } = await launch({ mobile: true });
  try {
    for (const p of ["present", "qa"]) {
      await page.goto(`${BASE}/${p}?s=does-not-exist`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.body.innerText.includes("기록을 찾을 수 없어요"), { timeout: 15000 }).catch(() => {});
      check(`${p}: unknown id → 기록을 찾을 수 없어요`, await hasText(page, "기록을 찾을 수 없어요"));
      await shot(page, `${OUT}/${p}-notfound.png`);
    }
  } finally {
    writeFileSync(`${OUT}/misc-console.log`, logs.join("\n"));
    writeFileSync(`${OUT}/misc-results.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }
}
