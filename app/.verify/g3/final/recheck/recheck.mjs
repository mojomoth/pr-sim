// Independent recheck (390x844) against http://localhost:3000 with every AI route stubbed by request interception.
// S1: wiki degraded=true + all 3 faces fail (providers_unavailable) → degraded note, one notice, real names/initials,
//     then full flow setup → present → qa → result → history (stubbed questions/followup/tts/report, stt token 503).
// S2: wiki degraded=false + faces OK → no degraded note, no outage notice.
// S3: /api/judges itself returns HTTP 503 → single notice.
// S4: 2 of 3 faces fail with the same code → single notice.
// S5: 2 faces fail with different codes → observe (per-row messages).
import { launch } from "../../../../../pocs/scripts/browser.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = new URL(".", import.meta.url).pathname;
const REPO = new URL("../../../../../", import.meta.url).pathname;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? "").slice(0, 400)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name, fullPage = false) => page.screenshot({ path: `${OUT}${name}.png`, fullPage });

const FACE = readFileSync(`${REPO}app/.verify/g2/api/judge.webp`).toString("base64");
const nd = (...lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

function silentWav(sec = 1.2, rate = 24000) {
  const n = Math.round(sec * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = silentWav();

const wikiBody = (degraded) =>
  nd(
    { type: "progress", phase: "extracting", chunksDone: 1, chunksTotal: 1, roundsDone: 0, roundsTotal: 1, msg: "" },
    {
      type: "done",
      wiki: [{ slug: "overview", title: "개요", type: "overview", summary: "해조류 완충재 사업 개요", sources: [1], markdown: "# 개요\n해조류 부산물 기반 완충재 (p.1)" }],
      keyNumbers: [],
      usage: degraded ? { "gemini:gemini-3.1-flash-lite": { calls: 2, inputTokens: 1, outputTokens: 1, ms: 1 } } : { "openai:gpt-6.1-terra": { calls: 2, inputTokens: 1, outputTokens: 1, ms: 1 } },
      ms: 900,
      degraded,
    },
  );

const qCaptured = readFileSync(`${REPO}app/.verify/g3/api-copy/questions-friendly.ndjson`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
function questionsBody(judges) {
  const qs = [];
  judges.slice(0, 2).forEach((j, ji) => {
    const src = qCaptured.questions[ji];
    qs.push({ ...src, id: `q_${j.id}_1`, judgeId: j.id, kind: "main" });
  });
  const ids = qs.map((q) => q.id);
  return nd(
    { type: "stage", stage: "context", msg: "자료 정리" },
    ...qs.map((q) => ({ type: "question", question: q })),
    { type: "done", questions: qs, pack: qCaptured.pack, lint: [], order: ids, main: ids, reserve: [], timings: {}, usage: [{ provider: "openai", model: "stub", inputTokens: 0, outputTokens: 0, ms: 1 }], degraded: false },
  );
}
const followupBody = () =>
  JSON.stringify({
    decision: "next",
    assessment: { score: 3, verdict: "부분", reason: "근거가 일부만 제시됐어요." },
    remark: "알겠습니다.",
    followup: null,
    usage: { provider: "openai", model: "stub", inputTokens: 0, outputTokens: 0, ms: 1 },
    degraded: false,
    latencyMs: 5,
  });
const rCaptured = readFileSync(`${REPO}app/.verify/g3/api-copy/report.ndjson`, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const allFail = (code, msg) => (temps) =>
  nd(...temps.map((_, slot) => ({ type: "error", slot, code, message: msg })), { type: "done", ms: 5 });
const PEOPLE = [
  { name: "도윤", fullName: "정도윤", gender: "male", age: 41 },
  { name: "서연", fullName: "한서연", gender: "female", age: 52 },
  { name: "민재", fullName: "오민재", gender: "male", age: 38 },
];
const okJudge = (slot, temperament) => ({ type: "judge", slot, model: "stub", judge: { id: `j_ok${slot}`, ...PEOPLE[slot % 3], temperament, voiceHint: "", image: { mime: "image/webp", base64: FACE } } });
const allOk = (temps) => nd(...temps.map((t, s) => okJudge(s, t)), { type: "done", ms: 5 });
const UNAVAIL = "AI 모델을 지금 쓸 수 없어요. 잠시 뒤 다시 시도해 주세요.";

async function open(label, { judges, degraded, judgesHttp503 = false }) {
  const { browser, page, logs } = await launch({ mobile: true, fakeAudioWav: `${REPO}pocs/fixtures/audio/answer-ko-16k.wav` });
  const calls = [];
  await page.evaluateOnNewDocument(() => {
    window.__audio = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__audio++; return play.apply(this, arguments); };
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const p = new URL(req.url()).pathname;
    if (!p.startsWith("/api/")) return req.continue();
    calls.push(p);
    const body = (() => { try { return JSON.parse(req.postData() ?? "{}"); } catch { return {}; } })();
    const j503 = (msg = "stub") => req.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "providers_unavailable", message: msg } }) });
    if (p === "/api/wiki") return req.respond({ status: 200, contentType: "application/x-ndjson", body: wikiBody(degraded) });
    if (p === "/api/judges") return judgesHttp503 ? j503(UNAVAIL) : req.respond({ status: 200, contentType: "application/x-ndjson", body: judges(body.temperaments ?? []) });
    if (p === "/api/stt/token") return j503("음성 인식을 지금 쓸 수 없어요.");
    if (p === "/api/questions") return req.respond({ status: 200, contentType: "application/x-ndjson", body: questionsBody(body.judges ?? []) });
    if (p === "/api/questions/followup") return req.respond({ status: 200, contentType: "application/json", body: followupBody() });
    if (p === "/api/tts") return req.respond({ status: 200, contentType: "audio/wav", headers: { "x-provider": "gemini", "x-model": "stub", "x-voice": "stub", "x-duration": "1.2", "access-control-expose-headers": "x-provider, x-model, x-voice, x-duration" }, body: WAV });
    if (p === "/api/report") {
      const lines = rCaptured.map((l) => (l.type === "done" ? { ...l, report: { ...l.report, meta: { ...l.report.meta, sessionId: body.session?.id ?? l.report.meta.sessionId } } } : l));
      return req.respond({ status: 200, contentType: "application/x-ndjson", body: nd(...lines) });
    }
    calls.push(`UNSTUBBED ${p}`);
    return j503();
  });
  await page.goto(`${BASE}/setup`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => location.search.includes("s="), { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll("ul[aria-label='심사위원 목록'] li").length === 3 && !document.body.innerText.includes("만드는 중"), { timeout: 30000 });
  await sleep(800);
  return { browser, page, logs, calls };
}

const judgeInfo = (page) =>
  page.evaluate(() => ({
    rows: [...document.querySelectorAll("ul[aria-label='심사위원 목록'] li")].map((li) => ({
      text: li.innerText.replace(/\s+/g, " ").trim(),
      img: [...li.querySelectorAll("img")].some((i) => i.naturalWidth > 0),
      initial: li.querySelector("[role=img]")?.textContent?.trim() ?? null,
      label: li.querySelector("[role=img]")?.getAttribute("aria-label") ?? null,
    })),
    outage: [...document.querySelectorAll("[data-testid=face-outage]")].map((e) => e.innerText.replace(/\s+/g, " ")),
    alerts: [...document.querySelectorAll("[role=alert]")].map((e) => e.innerText.replace(/\s+/g, " ")),
    generic: (document.body.innerText.match(/AI 모델을 지금 쓸 수 없어요/g) ?? []).length,
    hint: document.body.innerText.includes("얼굴 사진이 없는 심사위원은 이름 첫 글자로 표시돼요."),
  }));

async function loadSample(page) {
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("샘플 자료로 해보기"))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("자료 분석을 마쳤어요"), { timeout: 40000 });
  await sleep(500);
}
const degradedNote = (page) => page.$eval("[data-testid=wiki-degraded]", (e) => e.textContent).catch(() => null);

// ── S1 ──
{
  const { browser, page, logs, calls } = await open("S1", { judges: allFail("providers_unavailable", UNAVAIL), degraded: true });
  let sid = "";
  try {
    sid = new URL(page.url()).searchParams.get("s");
    const ji = await judgeInfo(page);
    await page.$eval("ul[aria-label='심사위원 목록']", (e) => e.scrollIntoView({ block: "center" }));
    await sleep(300);
    await shot(page, "S1-01-faces-all-failed");
    check("b1 all 3 faces failed → exactly one notice, no per-row generic message", ji.outage.length === 1 && ji.generic === 0 && !ji.hint, ji);
    const names = ji.rows.map((r) => r.label);
    check("b2 faceless judges show real names with matching initials", names.length === 3 && names.every((n) => n && !/새 위원|^새$/.test(n)) && ji.rows.every((r) => r.initial && r.label?.startsWith(r.initial)) && new Set(names).size === 3, ji.rows);

    await loadSample(page);
    const note = await degradedNote(page);
    await page.$eval("[data-testid=wiki-degraded]", (e) => e.scrollIntoView({ block: "center" })).catch(() => {});
    await sleep(300);
    await shot(page, "S1-02-degraded-note");
    // Must sit on the presentation doc row (inside the upload section, after the file name)
    const onRow = await page.evaluate(() => {
      const n = document.querySelector("[data-testid=wiki-degraded]");
      if (!n) return null;
      let el = n;
      for (let i = 0; i < 6 && el; i++) { if (/presentation\.pdf|발표 자료/.test(el.innerText) && el.innerText.length < 600) return el.innerText.replace(/\s+/g, " ").slice(0, 300); el = el.parentElement; }
      return false;
    });
    check("a1 degraded=true → note shown on the setup doc row", !!note && /경량 대체 모델/.test(note) && !!onRow, { note, onRow });

    // durations 1+1
    for (let i = 0; i < 10; i++) await page.$eval("button[aria-label='발표 시간 1분 줄이기']", (b) => b.click()).catch(() => {});
    for (let i = 0; i < 10; i++) await page.$eval("button[aria-label='질의응답 시간 1분 줄이기']", (b) => b.click()).catch(() => {});
    await sleep(800);
    const footer = await page.evaluate(() => document.body.innerText.match(/총 \d+분 · 심사위원 \d명/)?.[0]);
    check("d1 setup ready 1+1 min, 3 judges", footer === "총 2분 · 심사위원 3명", footer);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "S1-03-setup-ready");
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].find((b) => b.textContent?.includes("발표 시작하기"))?.disabled, { timeout: 15000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("발표 시작하기"))?.click());
    await page.waitForFunction(() => location.pathname === "/present", { timeout: 20000 });
    await page.waitForSelector("[data-slide-viewer][data-state=ready]", { timeout: 30000 });
    await sleep(800);
    const presentText = await page.evaluate(() => document.body.innerText);
    check("d2 /present shows the same judge names", names.every((n) => presentText.includes(n)), names);
    await shot(page, "S1-04-present-before");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("발표 시작"))?.click());
    await sleep(4000);
    await shot(page, "S1-05-present-live");
    const timeUp = await page.waitForFunction(() => document.body.innerText.includes("발표 시간이 끝났어요"), { timeout: 90000, polling: 500 }).then(() => true, () => false);
    await shot(page, "S1-06-present-timeup");
    check("d3 presentation runs to the time-up dialog", timeUp);
    await page.evaluate(() => [...document.querySelectorAll("a, button")].find((b) => b.textContent?.includes("질의응답 시작하기"))?.click());
    await page.waitForFunction(() => location.pathname === "/qa", { timeout: 20000 });
    const ready = await page.waitForFunction(() => /질문이 준비됐어요|질문을 준비하지 못했어요/.test(document.body.innerText), { timeout: 60000, polling: 500 }).then(() => page.evaluate(() => document.body.innerText.includes("질문이 준비됐어요")), () => false);
    await shot(page, "S1-07-qa-ready");
    check("d4 qa questions ready (stubbed)", ready);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("질의응답 시작") && !b.disabled)?.click());
    const t0 = Date.now();
    let clicks = 0;
    while (Date.now() - t0 < 100000) {
      const st = await page.evaluate(() => ({
        ended: /질의응답 시간이 끝났어요|준비한 질문이 모두 끝났어요/.test(document.body.innerText),
        can: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("답변 완료") && !b.disabled),
      }));
      if (st.ended) break;
      if (st.can) {
        if (clicks === 0) await shot(page, "S1-08-qa-answering");
        await sleep(1500);
        await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("답변 완료") && !b.disabled)?.click());
        clicks++;
      }
      await sleep(800);
    }
    await shot(page, "S1-09-qa-end");
    const qaEnded = await page.evaluate(() => /질의응답 시간이 끝났어요|준비한 질문이 모두 끝났어요/.test(document.body.innerText));
    check("d5 qa ends (questions asked, answers submitted)", qaEnded, { clicks, audioPlays: await page.evaluate(() => window.__audio) });
    await page.evaluate(() => [...document.querySelectorAll("a, button")].find((b) => b.textContent?.includes("결과 보기"))?.click());
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 20000 });
    const rep = await page.waitForFunction(() => !/결과를 정리하고 있어요/.test(document.body.innerText), { timeout: 60000, polling: 500 }).then(() => true, () => false);
    await sleep(1500);
    await shot(page, "S1-10-result");
    const resultText = await page.evaluate(() => document.body.innerText.slice(0, 600));
    check("d6 result renders the (stubbed) report", rep && !/리포트를 만들지 못했어요|오류/.test(resultText.slice(0, 200)), resultText.slice(0, 200));
    await page.goto(`${BASE}/history`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const listed = await page.evaluate((sid) => !!document.querySelector(`a[href="/result?s=${sid}"]`), sid);
    await shot(page, "S1-11-history");
    check("d7 history lists the session", listed, sid);
    const before = calls.filter((c) => c === "/api/report").length;
    await page.evaluate((sid) => document.querySelector(`a[href="/result?s=${sid}"]`)?.click(), sid);
    await page.waitForFunction(() => location.pathname === "/result", { timeout: 15000 });
    await sleep(2500);
    await shot(page, "S1-12-history-reopen");
    check("d8 reopen from history uses stored report", calls.filter((c) => c === "/api/report").length === before, { before });
  } catch (e) {
    check("S1 finished without exceptions", false, String(e?.message ?? e));
    await shot(page, "S1-error").catch(() => {});
  } finally {
    writeFileSync(`${OUT}S1-logs.txt`, [...calls, "----", ...logs].join("\n"));
    await browser.close();
  }
}

// ── S2: degraded=false, faces OK ──
{
  const { browser, page, logs, calls } = await open("S2", { judges: allOk, degraded: false });
  try {
    const ji = await judgeInfo(page);
    await loadSample(page);
    const note = await degradedNote(page);
    await page.evaluate(() => [...document.querySelectorAll("p")].find((p) => p.textContent.includes("자료 분석을 마쳤어요"))?.scrollIntoView({ block: "center" }));
    await sleep(300);
    await shot(page, "S2-01-no-degraded-note");
    check("a2 degraded=false → no degraded note", note === null, { note });
    check("S2 faces OK → no outage notice, photos shown", ji.outage.length === 0 && ji.rows.every((r) => r.img), ji);
    await page.$eval("ul[aria-label='심사위원 목록']", (e) => e.scrollIntoView({ block: "center" }));
    await sleep(300);
    await shot(page, "S2-02-faces-ok");
  } catch (e) {
    check("S2 finished without exceptions", false, String(e?.message ?? e));
  } finally {
    writeFileSync(`${OUT}S2-logs.txt`, [...calls, "----", ...logs].join("\n"));
    await browser.close();
  }
}

// ── S3/S4/S5 ──
const mixed = (codes) => (temps) =>
  nd(...temps.map((t, s) => (codes[s] ? { type: "error", slot: s, code: codes[s], message: codes[s] === "rate_limited" ? "요청이 많아요. 잠시 뒤 다시 시도해 주세요." : UNAVAIL } : okJudge(s, t))), { type: "done", ms: 5 });
for (const [label, opts, expectOne] of [
  ["S3-judges-http503", { judges: allOk, degraded: false, judgesHttp503: true }, true],
  ["S4-two-same-code", { judges: mixed([null, "providers_unavailable", "providers_unavailable"]), degraded: false }, true],
  ["S5-two-diff-codes", { judges: mixed([null, "providers_unavailable", "rate_limited"]), degraded: false }, null],
]) {
  const { browser, page, logs, calls } = await open(label, opts);
  try {
    const ji = await judgeInfo(page);
    await page.$eval("ul[aria-label='심사위원 목록']", (e) => e.scrollIntoView({ block: "center" }));
    await sleep(300);
    await shot(page, label);
    const names = ji.rows.map((r) => r.label ?? r.text);
    const goodNames = ji.rows.every((r) => !/새 위원/.test(r.text));
    if (expectOne) check(`b ${label}: one notice, real names`, ji.outage.length === 1 && ji.generic === 0 && goodNames, ji);
    else check(`b ${label} (observe): notices/alerts`, goodNames, ji);
  } catch (e) {
    check(`${label} finished without exceptions`, false, String(e?.message ?? e));
  } finally {
    writeFileSync(`${OUT}${label}-logs.txt`, [...calls, "----", ...logs].join("\n"));
    await browser.close();
  }
}

writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
console.log(results.every((r) => r.ok) ? "ALL PASS" : `FAILED ${results.filter((r) => !r.ok).length}`);
