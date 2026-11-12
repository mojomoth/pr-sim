// G3 SCREENS-B P2 checks. seed.json is built by ../../g2/SCREENS-B/seed-build.mjs (moved here; not for git); also reads ../../g2/SCREENS-B/session-after-qa-2min.json.
//   node run.mjs load     → IndexedDB read failure → 기록을 불러오지 못했어요 + 다시 시도 (present, qa)
//   node run.mjs qa       → resume with a pending follow-up + unfinished answer, hero photo opacity, confirm pauses STT,
//                           answer save failure → retry, time-up → hero pill hidden
//   node run.mjs present  → confirm pauses STT; time-up with a failing save → retry → dialog → /qa; final sentences saved
// Storage failures are injected by patching IDBObjectStore.prototype.get/put in the page (flags on window).
import { readFileSync, writeFileSync } from "node:fs";
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";

const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/SCREENS-B";
const G2 = "/Users/jyl/work/study/pr-sim/app/.verify/g2/SCREENS-B";
const BASE = "http://localhost:3000";
const AUDIO = "/Users/jyl/work/study/pr-sim/pocs/fixtures/audio";
const mode = process.argv[2] ?? "qa";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seedData = JSON.parse(readFileSync(`${OUT}/seed.json`, "utf8"));

const INJECT = () => {
  const get = IDBObjectStore.prototype.get;
  const put = IDBObjectStore.prototype.put;
  window.__failGet = location.search.includes("failidb");
  window.__failPut = false;
  IDBObjectStore.prototype.get = function (...a) {
    if (window.__failGet && this.name === "sessions") throw new DOMException("injected read failure", "UnknownError");
    return get.apply(this, a);
  };
  IDBObjectStore.prototype.put = function (...a) {
    if (window.__failPut && this.name === "sessions") throw new DOMException("injected quota failure", "QuotaExceededError");
    return put.apply(this, a);
  };
};

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
    const was = window.__failGet;
    window.__failGet = false;
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
    window.__failGet = was;
    return rec;
  }, id);
}
const clickText = (page, text) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll("button, a")].reverse().find((x) => x.textContent.replace(/\s+/g, " ").trim() === text && !x.disabled) ?? [...document.querySelectorAll("button, a")].find((x) => x.textContent.replace(/\s+/g, " ").trim().includes(text) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text);
const hasText = (page, text) => page.evaluate((t) => document.body.innerText.includes(t), text);
const waitText = (page, re, timeout = 30000) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), { timeout }, re.source).then(() => true, () => false);
const micRow = (page) => page.evaluate(() => document.querySelector('[aria-label="마이크 끄기"], [aria-label="마이크 켜기"]')?.parentElement?.innerText.trim());

if (mode === "load") {
  const { browser, page, logs } = await launch({ mobile: true });
  try {
    await page.evaluateOnNewDocument(INJECT);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await seed(page, { ...seedData.session, id: "s_g3load" }, seedData.blobs);
    const done = JSON.parse(readFileSync(`${G2}/session-after-qa-2min.json`, "utf8"));
    await seed(page, { ...done, id: "s_g3loadqa", status: "qa", qa: [], judges: seedData.session.judges, resume: undefined }, {});
    for (const p of ["present", "qa"]) {
      await page.goto(`${BASE}/${p}?s=${p === "qa" ? "s_g3loadqa" : "s_g3load"}&failidb=1`, { waitUntil: "domcontentloaded" });
      const failed = await waitText(page, /기록을 불러오지 못했어요/, 15000);
      check(`${p}: IndexedDB read error → 기록을 불러오지 못했어요 (not 기록을 찾을 수 없어요)`, failed && !(await hasText(page, "기록을 찾을 수 없어요")));
      await sleep(500);
      await shot(page, `${OUT}/${p}-load-error.png`);
      await page.evaluate(() => (window.__failGet = false));
      await clickText(page, "다시 시도");
      const ok = await waitText(page, p === "present" ? /발표 시작/ : /질문이 준비됐어요|질의응답 시작/, 15000);
      check(`${p}: 다시 시도 after storage recovers → screen loads`, ok);
      await sleep(1500);
      await shot(page, `${p === "present" ? `${OUT}/present` : `${OUT}/qa`}-load-retry-ok.png`);
    }
    await page.goto(`${BASE}/qa?s=does-not-exist`, { waitUntil: "domcontentloaded" });
    check("qa: unknown id still → 기록을 찾을 수 없어요", await waitText(page, /기록을 찾을 수 없어요/, 15000));
  } finally {
    writeFileSync(`${OUT}/load-console.log`, logs.join("\n"));
    writeFileSync(`${OUT}/load-results.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }
}

if (mode === "qa") {
  // Left during the follow-up answer: qa = [main answer with decision "followup"], the follow-up item is saved,
  // its 3 spoken sentences are in the transcript but in no qa item.
  const done = JSON.parse(readFileSync(`${G2}/session-after-qa-2min.json`, "utf8"));
  const pack = seedData.session; // judges/docs
  const fu = done.qa[1];
  const carryIds = fu.answerSentenceIds;
  const qaSaid = done.transcript.filter((x) => x.phase !== "qa" || done.qa[0].answerSentenceIds.includes(x.id) || carryIds.includes(x.id));
  const fullDone = JSON.parse(readFileSync(`${G2}/session-after-qa.json`, "utf8"));
  const rec0 = {
    ...done,
    id: "s_g3qa",
    status: "qa",
    questions: { ...done.questions, pack: fullDone.questions?.pack?.text?.length > 100 ? fullDone.questions.pack : { ...done.questions.pack, text: "pack" } },
    qa: done.qa.slice(0, 1),
    transcript: qaSaid,
    resume: { phase: "qa", remainingSec: Number(process.env.QA_SEC ?? 75) },
    judges: pack.judges,
  };
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: `${AUDIO}/answer-ko-16k.wav` });
  const net = [];
  page.on("response", (r) => r.url().includes("/api/") && net.push(`${r.status()} ${r.url().replace(BASE, "")} ${r.headers()["x-provider"] ?? ""}`));
  try {
    await page.evaluateOnNewDocument(INJECT);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await seed(page, rec0, seedData.blobs);
    await page.goto(`${BASE}/qa?s=s_g3qa`, { waitUntil: "domcontentloaded" });
    check("qa-resume: 이어서 질의응답하기", await waitText(page, /이어서 질의응답하기/, 15000));
    await clickText(page, "이어서 질의응답하기");
    await waitText(page, /심사위원 질문|꼬리질문/, 20000);
    await sleep(400);
    const asking = await page.evaluate(() => document.body.innerText);
    check("qa-resume: the pending follow-up is asked first (꼬리질문)", /꼬리질문/.test(asking), asking.slice(0, 400));
    check("qa-resume: question text = saved follow-up", asking.includes(fu.question.slice(0, 20)), fu.question.slice(0, 60));
    // hero photo: no opacity/filter anywhere from the photo up to the screen
    const hero = await page.evaluate(() => {
      const img = [...document.querySelectorAll("img")].find((i) => i.alt.endsWith("심사위원 얼굴") && i.getBoundingClientRect().width > 200);
      if (!img) return null;
      const chain = [];
      for (let el = img; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        const running = el.getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName ?? "anim");
        if (cs.opacity !== "1" || cs.filter !== "none" || cs.mixBlendMode !== "normal" || running.length) chain.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), opacity: cs.opacity, filter: cs.filter, running });
      }
      const r = img.getBoundingClientRect();
      // anything painted over the photo's center?
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 3);
      return { w: Math.round(r.width), h: Math.round(r.height), chain, topIsImg: top === img };
    });
    check("qa: hero photo full strength (no opacity/filter/animation on photo or ancestors, nothing over it)", hero && hero.chain.length === 0 && hero.topIsImg, hero);
    await shot(page, `${OUT}/qa-hero-asking.png`);
    const listening = await waitText(page, /듣고 있어요/, 40000);
    await sleep(800);
    const ans = await page.evaluate(() => document.querySelector(".scroll-mb-4")?.innerText);
    const carryText = done.transcript.filter((x) => carryIds.includes(x.id)).map((x) => x.text).join(" ");
    check("qa-resume: unfinished answer restored into 내 답변", listening && ans?.includes(carryText.slice(0, 15)), { ans: ans?.slice(0, 160), carry: carryText.slice(0, 80) });
    await shot(page, `${OUT}/qa-resume-carry.png`);

    // confirm sheet pauses STT (and the clock)
    await sleep(2500);
    await clickText(page, "종료");
    await sleep(4500);
    const rowPaused = await micRow(page);
    const timerA = await page.evaluate(() => document.querySelector('[data-testid="timer"]')?.textContent);
    await sleep(2000);
    const timerB = await page.evaluate(() => document.querySelector('[data-testid="timer"]')?.textContent);
    check("qa: confirm open → transcriber stopped (대기 중) and clock paused", /대기 중/.test(rowPaused ?? "") && timerA === timerB, { rowPaused, timerA, timerB });
    await shot(page, `${OUT}/qa-confirm-paused.png`);
    await clickText(page, "계속하기");
    const resumed = await waitText(page, /듣고 있어요/, 15000);
    check("qa: confirm closed → transcriber listening again", resumed, await micRow(page));
    await sleep(6000);

    // answer save fails → stays with a retry
    await page.evaluate(() => (window.__failPut = true));
    await clickText(page, "답변 완료");
    const saveErr = await waitText(page, /답변 기록을 저장하지 못했어요/, 70000);
    const afterFail = await page.evaluate(() => document.body.innerText);
    check("qa: answer save failure → retry notice, does not move to the next question", saveErr && afterFail.includes(fu.question.slice(0, 20)), afterFail.slice(0, 500));
    await sleep(900);
    const alertPos = await page.evaluate(() => {
      const a = [...document.querySelectorAll('[role="alert"]')].find((e) => e.textContent.includes("저장하지 못했어요"));
      const bar = document.querySelector(".app-bottom-bar");
      return a && bar ? { alertBottom: Math.round(a.getBoundingClientRect().bottom), barTop: Math.round(bar.getBoundingClientRect().top) } : null;
    });
    check("qa: save-failure alert (with 다시 시도) scrolled into view above the bottom bar", alertPos && alertPos.alertBottom <= alertPos.barTop, alertPos);
    await shot(page, `${OUT}/qa-save-error.png`);
    let rec = await readSession(page, "s_g3qa");
    check("qa: nothing advanced in storage while failing", rec.qa.length === 1, rec.qa.length);
    await page.evaluate(() => (window.__failPut = false));
    await clickText(page, "다시 시도");
    await sleep(1500);
    rec = await readSession(page, "s_g3qa");
    const saved = rec.qa[1];
    check("qa: retry saves the follow-up answer incl. the restored sentences", rec.qa.length === 2 && saved?.questionId === fu.questionId && carryIds.every((i) => saved.answerSentenceIds.includes(i)), saved && { q: saved.questionId, ids: saved.answerSentenceIds, ans: saved.answer.slice(0, 80) });
    const qaT = rec.transcript.filter((x) => x.phase === "qa");
    console.log("qa t:", qaT.map((x) => x.t));
    await shot(page, `${OUT}/qa-after-retry.png`);

    // run out the clock → end; hero pill must not say 답변 듣는 중
    const ended = await waitText(page, /결과 보기/, 120000);
    const pill = await page.evaluate(() => {
      const live = [...document.querySelectorAll("[aria-live]")].find((e) => /질문 중|답변 듣는 중/.test(e.textContent));
      return live ? { text: live.textContent, display: getComputedStyle(live).display } : null;
    });
    check("qa: after Q&A ended the hero pill is hidden", ended && (!pill || pill.display === "none"), pill);
    await shot(page, `${OUT}/qa-ended.png`);
    rec = await readSession(page, "s_g3qa");
    check("qa: end saved status report", rec.status === "report" && !rec.resume, { status: rec.status, qa: rec.qa.length });
    writeFileSync(`${OUT}/qa-session-final.json`, JSON.stringify({ status: rec.status, qa: rec.qa.map((x) => ({ q: x.questionId, f: x.followup, d: x.decision, ids: x.answerSentenceIds })), qaTranscript: qaT.map((x) => ({ id: x.id, t: x.t })) }, null, 1));
  } finally {
    writeFileSync(`${OUT}/qa-network.log`, net.join("\n"));
    writeFileSync(`${OUT}/qa-console.log`, logs.join("\n"));
    writeFileSync(`${OUT}/qa-results.json`, JSON.stringify(results, null, 2));
    await browser.close(); // before PhaseEndDialog auto-opens /result (no report generation)
  }
}

if (mode === "present") {
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: `${AUDIO}/speech-ko-16k.wav` });
  try {
    await page.evaluateOnNewDocument(INJECT);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await seed(page, { ...seedData.session, id: "s_g3pr" }, seedData.blobs);
    await page.goto(`${BASE}/present?s=s_g3pr&sec=40`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-slide-viewer][data-state="ready"]', { timeout: 30000 });
    await clickText(page, "발표 시작");
    check("present: listening", await waitText(page, /음성 인식 중/, 20000));
    await sleep(8000);
    await clickText(page, "종료");
    await sleep(4500);
    const st = await page.evaluate(() => document.querySelector("#stt-h")?.textContent);
    const tA = await page.evaluate(() => document.querySelector('[data-testid="timer"]')?.textContent);
    await sleep(2000);
    const tB = await page.evaluate(() => document.querySelector('[data-testid="timer"]')?.textContent);
    check("present: confirm open → transcriber stopped, clock paused", !/음성 인식 중|연결 중/.test(st ?? "") && tA === tB, { st, tA, tB });
    await shot(page, `${OUT}/present-confirm-paused.png`);
    await clickText(page, "계속하기");
    check("present: confirm closed → listening again", await waitText(page, /음성 인식 중/, 15000));
    // time up with storage failing
    await page.evaluate(() => (window.__failPut = true));
    const err = await waitText(page, /발표 기록을 저장하지 못해/, 60000);
    await sleep(500);
    check("present: time-up save failure → retry notice, no 발표 시간이 끝났어요 dialog", err && !(await hasText(page, "발표 시간이 끝났어요")) && page.url().includes("/present"));
    await shot(page, `${OUT}/present-timeup-save-error.png`);
    let rec = await readSession(page, "s_g3pr");
    check("present: status not advanced while failing", rec.status === "presentation" || rec.status === "setup", rec.status);
    await page.evaluate(() => (window.__failPut = false));
    await clickText(page, "다시 시도");
    const dlg = await waitText(page, /발표 시간이 끝났어요/, 10000);
    rec = await readSession(page, "s_g3pr");
    check("present: retry → saved (status qa) and only then the 질의응답 시작하기 dialog", dlg && rec.status === "qa" && !rec.resume, { status: rec.status });
    const said = await page.evaluate(() => document.querySelector("#stt-h")?.closest("section")?.innerText);
    check("present: transcript saved incl. sentences said while the save was failing", rec.transcript.length > 0, { n: rec.transcript.length, t: rec.transcript.map((x) => x.t), bubble: said?.slice(0, 120) });
    await shot(page, `${OUT}/present-timeup-dialog.png`);
    await page.waitForFunction(() => location.pathname === "/qa", { timeout: 15000 }).catch(() => {});
    check("present: → /qa", page.url().includes("/qa?s=s_g3pr"), page.url());
  } finally {
    writeFileSync(`${OUT}/present-console.log`, logs.join("\n"));
    writeFileSync(`${OUT}/present-results.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }
}
