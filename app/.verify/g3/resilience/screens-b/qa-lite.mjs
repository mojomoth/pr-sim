// SCREENS-B: /qa shows the degraded-quality note when /api/questions (done.degraded) or
// /api/questions/followup (degraded) came from a lite fallback model. Replays the REAL server
// responses the API role recorded during the outage (no Gemini quota spent), plus a control run.
import { launch, shot } from "/Users/jyl/work/study/pr-sim/pocs/scripts/browser.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const APP = "http://localhost:3000";
const API = "/Users/jyl/work/study/pr-sim/app/.verify/g3/resilience/api";
const OUT = "/Users/jyl/work/study/pr-sim/app/.verify/g3/resilience/screens-b";
const req = JSON.parse(readFileSync(`${API}/questions-req.json`, "utf8"));
const qLite = readFileSync(`${API}/questions-res.ndjson`, "utf8");
const fLite = readFileSync(`${API}/followup-res.json`, "utf8");
// control: the same payloads as if the primary provider had answered
const qOk = qLite.replace(/"degraded":true/g, '"degraded":false').replace(/gemini-3\.5-flash-lite/g, "gpt-6.1-terra").replace(/"provider":"gemini"/g, '"provider":"openai"');
const fOk = fLite.replace(/"degraded":true/g, '"degraded":false').replace(/gemini-3\.5-flash-lite/g, "gpt-5.5").replace(/"provider":"gemini"/g, '"provider":"openai"');
const NOTE = "경량 대체 모델";
const results = [];
const check = (name, ok, detail) => (results.push({ name, ok: !!ok, detail }), console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail ?? ""));

function session(id) {
  const now = new Date().toISOString();
  const d = req.docs[0];
  return {
    id, status: "qa", createdAt: now, updatedAt: now,
    setup: { situation: req.situation, presentationMinutes: req.presentationMinutes, qaMinutes: req.qaMinutes },
    docs: { presentation: { role: "presentation", docId: d.docId ?? "fixture", filename: d.filename, bytes: 1, pageCount: d.pageTexts.length, pdfKey: "pdf:fixture", pageTexts: d.pageTexts, emptyPages: [], wikiState: "pending" } },
    judges: req.judges.map((j) => ({ ...j, voiceHint: "", imageKey: `judge:${j.id}`, thumbKey: `judge:${j.id}:thumb` })),
    transcript: req.transcript, qa: [],
  };
}

async function run(label, qBody, fBody, after = label === "lite") {
  const { browser, page, logs } = await launch({ mobile: true });
  const calls = [];
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url()).pathname;
    if (u === "/api/questions") return calls.push(u), r.respond({ status: 200, contentType: "application/x-ndjson", body: qBody });
    if (u === "/api/questions/followup") return calls.push(u), r.respond({ status: 200, contentType: "application/json", body: fBody });
    if (u === "/api/tts") return calls.push(u), r.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "providers_unavailable", message: "AI 모델을 지금 쓸 수 없어요.", fallback: "browser" } }) });
    if (u.startsWith("/api/")) return calls.push(u), r.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "providers_unavailable", message: "AI 모델을 지금 쓸 수 없어요." } }) });
    r.continue();
  });
  const sid = `lite-${label}-${Date.now()}`;
  try {
    await page.goto(APP, { waitUntil: "networkidle2" });
    await page.evaluate(
      (rec) =>
        new Promise((res, rej) => {
          const o = indexedDB.open("pr-sim", 1);
          o.onupgradeneeded = () => (o.result.createObjectStore("sessions", { keyPath: "id" }), o.result.createObjectStore("blobs"));
          o.onsuccess = () => {
            const tx = o.result.transaction("sessions", "readwrite");
            tx.objectStore("sessions").put(rec);
            tx.oncomplete = () => (o.result.close(), res());
            tx.onerror = () => rej(tx.error);
          };
        }),
      session(sid),
    );
    await page.goto(`${APP}/qa?s=${sid}`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.innerText.includes("질문이 준비됐어요"), { timeout: 30_000 });
    const text = () => page.evaluate(() => document.body.innerText);
    const expect = label === "lite";
    check(`${label}: ready screen note ${expect ? "shown" : "absent"}`, (await text()).includes(NOTE) === expect, (await text()).split("\n").find((l) => l.includes(NOTE)));
    await shot(page, `${OUT}/lite-${label}-1-ready.png`);

    if (expect) {
      // resume after reload: the note is kept with the stored questions
      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForFunction(() => /질문이 준비됐어요|이어서 질문을/.test(document.body.innerText), { timeout: 30_000 });
      check("lite: note survives reload (stored with questions)", (await text()).includes(NOTE));
      const stored = await page.evaluate(
        (id) => new Promise((res) => { const o = indexedDB.open("pr-sim", 1); o.onsuccess = () => { const g = o.result.transaction("sessions").objectStore("sessions").get(id); g.onsuccess = () => res(g.result.questions?.lite); }; }),
        sid,
      );
      check("lite: questions.lite persisted", JSON.stringify(stored) === '["gemini-3.5-flash-lite"]', stored);
    }

    const clickText = (t) => page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.innerText.includes(t))?.click(), t);
    await clickText("질의응답");
    await page.waitForFunction(() => document.body.innerText.includes("심사위원 질문"), { timeout: 20_000 });
    await shot(page, `${OUT}/lite-${label}-2-asking.png`);
    check(`${label}: live note ${expect ? "shown" : "absent"} while a question is asked`, (await text()).includes(NOTE) === expect);
    // answer stage → 답변 완료 twice (no recognized answer) → follow-up request
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.innerText.includes("답변 완료") && !b.disabled), { timeout: 60_000 });
    await clickText("답변 완료");
    await new Promise((r) => setTimeout(r, 1500));
    await clickText("답변 완료");
    await page.waitForFunction(() => document.body.innerText.includes("꼬리질문"), { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, `${OUT}/lite-${label}-3-followup.png`, { fullPage: true });
    const t = await text();
    check(`${label}: follow-up asked`, t.includes("꼬리질문"));
    check(`${label}: note ${after ? "shown" : "absent"} with the follow-up`, t.includes(NOTE) === after, t.split("\n").find((l) => l.includes(NOTE)));
  } catch (e) {
    check(`${label}: run finished`, false, String(e?.message ?? e));
    await shot(page, `${OUT}/lite-${label}-error.png`).catch(() => {});
  } finally {
    writeFileSync(`${OUT}/lite-${label}-console.log`, logs.join("\n"));
    writeFileSync(`${OUT}/lite-${label}-calls.json`, JSON.stringify(calls, null, 1));
    await browser.close();
  }
}


await run("lite", qLite, fLite);
await run("primary", qOk, fOk);
await run("followup-lite", qOk, fLite, true); // questions from the primary model, only the follow-up from lite
writeFileSync(`${OUT}/results-lite.json`, JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
