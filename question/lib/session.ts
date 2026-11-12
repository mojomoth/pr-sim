import "server-only";
import { loadSampleSession, readFixture } from "@/fixtures/lib";
import type { QAItem, SessionRecord, TranscriptSentence } from "@/lib/types";
import { ingestPdf, listDocs } from "@/wiki/lib";
import { listJudges, toPersona } from "@/judge/lib";
import { cachedLint } from "./context";
import { loadAttempt, loadRun, newId, saveSessionFiles } from "./store";
import type { QJudge } from "./types";

// Inputs for the PoC UI/tests: fixture transcript/judges, fixture PDFs ingested into the wiki (reused by
// content hash → instant when already ingested), generated judge faces, and SessionRecord persistence.

export async function ensureFixtureDocs(): Promise<{ presentationDocId: string; proposalDocId: string; reused: boolean[] }> {
  const [deck, plan] = await Promise.all([readFixture("presentationPdf"), readFixture("proposalPdf")]);
  const [a, b] = await Promise.all([
    ingestPdf(deck, "presentation.pdf", { kind: "presentation" }),
    ingestPdf(plan, "proposal.pdf", { kind: "proposal" }),
  ]);
  return { presentationDocId: a.docId, proposalDocId: b.docId, reused: [a.reused, b.reused] };
}

/** "대본 전체": presentation-script.txt → TranscriptSentence[] with t estimated at ~7.5 chars/s. */
export async function scriptTranscript(): Promise<TranscriptSentence[]> {
  const txt = (await readFixture("script")).toString("utf8");
  let t = 1;
  return txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => {
      const s = { t: Math.round(t * 10) / 10, text, phase: "presentation" as const };
      t += text.length / 7.5 + 0.6;
      return s;
    });
}

export async function sampleSetup() {
  const s = await loadSampleSession();
  const judges: QJudge[] = s.judges.map((j) => ({ ...j, gender: j.gender ?? "male", age: j.age ?? 50 }));
  return { situation: s.situation, presentationMinutes: s.presentationMinutes, qaMinutes: s.qaMinutes, transcript: s.transcript, judges };
}

/** Generated judges from the judge PoC (faces). */
export async function generatedJudges(): Promise<QJudge[]> {
  try {
    return (await listJudges()).map((r) => {
      const p = toPersona(r);
      return { id: p.id, name: p.name, temperament: p.temperament, gender: r.gender, age: r.age, imageUrl: p.imageUrl ? `${p.imageUrl}?size=card` : undefined, fullName: p.fullName };
    });
  } catch {
    return [];
  }
}

export async function setupData() {
  const [sample, script, docs, faces] = await Promise.all([sampleSetup(), scriptTranscript(), listDocs(), generatedJudges()]);
  const ready = docs.filter((d) => d.state === "ready");
  const pick = (kind: "presentation" | "proposal", name: string) => (ready.find((d) => d.kind === kind && d.filename === name) ?? ready.find((d) => d.kind === kind))?.docId;
  const defaults = { presentationDocId: pick("presentation", "presentation.pdf"), proposalDocId: pick("proposal", "proposal.pdf") };
  return { sample, script, docs, faces, defaults };
}

/** Start the (cached) cross-doc lint for the default pair in the background so the first generate is fast. */
export function warmLint(d: { presentationDocId?: string; proposalDocId?: string }) {
  const main = d.proposalDocId ?? d.presentationDocId;
  if (!main) return;
  cachedLint(main, d.proposalDocId && d.presentationDocId ? d.presentationDocId : undefined).catch(() => {});
}

/**
 * Build + persist a SessionRecord (lib/types contract) from a run and ONE Q&A session's log: the client's
 * qa[] if given, else the attempt's log on the server (else the legacy run.qa). The run is not modified.
 */
export async function saveSession(
  runId: string,
  qa: (QAItem & { questionId: string; judgeId?: string })[] | null,
  attemptId?: string,
): Promise<{ id: string; file: string; record: SessionRecord }> {
  const run = await loadRun(runId);
  if (!run) throw new Error("run not found");
  const attempt = attemptId ? await loadAttempt(runId, attemptId) : null;
  const log = qa && qa.length ? qa : (attempt?.qa ?? run.qa);
  const id = newId("qs");
  const record: SessionRecord = {
    id,
    situation: run.input.situation,
    presentationMinutes: run.input.presentationMinutes ?? 5,
    qaMinutes: run.input.qaMinutes,
    presentationDocId: run.input.presentationDocId,
    proposalDocId: run.input.proposalDocId,
    judges: run.input.judges.map((j) => ({ id: j.id, name: j.name, temperament: j.temperament, gender: j.gender, age: j.age, ...(j.imageUrl ? { imageUrl: j.imageUrl } : {}) })),
    transcript: run.input.transcript,
    qa: log.map((x) => ({ judge: { id: x.judge.id, name: x.judge.name, temperament: x.judge.temperament }, question: x.question, answer: x.answer, ...(x.askedAt != null ? { askedAt: x.askedAt } : {}) })),
    createdAt: new Date().toISOString(),
  };
  const questions = [...run.questions.filter((q) => q.kind !== "followup"), ...(attempt?.followups ?? [])];
  const meta = { runId: run.id, attemptId: attempt?.id ?? null, contextPackId: run.pack.id, questions, order: run.order, qaDetails: log, usage: run.usage, timings: run.timings, targets: run.pack.targets };
  const { file } = await saveSessionFiles(record, meta);
  return { id, file, record };
}
