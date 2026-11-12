// Seed helpers: a SessionRecord built from pocs/fixtures/sample-session.json + sample PDFs + mock judge faces.
import { readFileSync, existsSync } from "node:fs";
const fx = JSON.parse(readFileSync("/Users/jyl/work/study/pr-sim/pocs/fixtures/sample-session.json", "utf8"));
const docs = JSON.parse(readFileSync(new URL("./docs.json", import.meta.url), "utf8"));
const faces = ["judge-minseo.jpg", "judge-junho.jpg", "judge-doyun.jpg"].map((f) => readFileSync(`/Users/jyl/work/study/pr-sim/pocs/public/ui/${f}`).toString("base64"));
const pdfs = { presentation: readFileSync("/Users/jyl/work/study/pr-sim/app/public/samples/presentation.pdf").toString("base64"), proposal: readFileSync("/Users/jyl/work/study/pr-sim/app/public/samples/proposal.pdf").toString("base64") };

export function buildSession(id = "s_fixture_c1") {
  const transcript = fx.transcript.map((s, i) => ({ id: `p${i + 1}`, t: s.t, text: s.text, phase: "presentation", slide: s.slide ?? Math.min(12, 1 + Math.floor(s.t / 24)) }));
  const qa = fx.qa.map((x, i) => {
    const parts = x.answer.split(/(?<=[.?!])\s+/).filter(Boolean);
    const ids = parts.map((text, k) => {
      const sid = `q${i + 1}_${k + 1}`;
      transcript.push({ id: sid, t: (x.askedAt ?? i * 40) + 6 + k * 4, text, phase: "qa" });
      return sid;
    });
    return { ...x, questionId: `gq${i + 1}`, evidence: [], answerSentenceIds: ids };
  });
  const judges = fx.judges.map((j) => ({ ...j, fullName: j.name, name: j.name.slice(1), voiceHint: "", imageKey: `judge:${j.id}`, thumbKey: `judge:${j.id}:thumb` }));
  for (const x of qa) x.judge = { ...x.judge, name: x.judge.name.slice(1) };
  const stored = (role) => ({ role, docId: docs[role].docId, filename: docs[role].filename, bytes: docs[role].bytes, pageCount: docs[role].pageCount, pdfKey: `pdf:${docs[role].docId}`, pageTexts: docs[role].pageTexts, emptyPages: [], wikiState: "ready" });
  const now = new Date().toISOString();
  return {
    id, status: "report",
    setup: { situation: fx.situation, presentationMinutes: fx.presentationMinutes, qaMinutes: fx.qaMinutes },
    docs: { presentation: stored("presentation"), proposal: stored("proposal") },
    judges, transcript, qa, createdAt: fx.createdAt, updatedAt: now,
  };
}

/** Write the session + blobs into IndexedDB "pr-sim" of the page's origin. */
export async function seed(page, rec) {
  const blobs = [
    ...rec.judges.flatMap((j, i) => [[j.imageKey, faces[i % 3], "image/jpeg"], [j.thumbKey, faces[i % 3], "image/jpeg"]]),
    [rec.docs.presentation.pdfKey, pdfs.presentation, "application/pdf"],
    [rec.docs.proposal.pdfKey, pdfs.proposal, "application/pdf"],
  ];
  await page.evaluate(async (rec, blobs) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("pr-sim", 1);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions", { keyPath: "id" }); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(["sessions", "blobs"], "readwrite");
    tx.objectStore("sessions").put(rec);
    for (const [k, b64, type] of blobs) tx.objectStore("blobs").put(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type }), k);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  }, rec, blobs);
}

export async function readSession(page, id) {
  return page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("pr-sim", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rec = await new Promise((res) => { const g = db.transaction("sessions").objectStore("sessions").get(id); g.onsuccess = () => res(g.result); });
    db.close();
    return rec;
  }, id);
}
export const savedReportPath = new URL("./session-with-report.json", import.meta.url);
export const haveSaved = () => existsSync(savedReportPath);
