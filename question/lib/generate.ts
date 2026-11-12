import "server-only";
import { TEMPERAMENT_LABEL } from "@/lib/types";
import { buildContext } from "./context";
import { groundEvidence } from "./ground";
import { partialQuestions, providerLabel, streamJson, withRetry } from "./llm";
import { friendlyError } from "./providers";
import { PERSONAS, personaSystem, SHARED_RULES } from "./personas";
import { QuestionsOut, type QuestionOutT } from "./schema";
import { newId, saveRun } from "./store";
import { similarity } from "./text";
import type { ContextPack, FocusTarget, GeneratedQuestion, GenerateEvent, GenerateInput, LlmUsage, QJudge, QuestionRun } from "./types";

/** Average seconds one Q&A exchange takes (question TTS ~10 s + answer ~35 s + transitions). */
export const SECONDS_PER_EXCHANGE = 55;

export function plannedQuestionCount(qaMinutes: number, override?: number): number {
  if (override) return override;
  return Math.max(1, Math.min(10, Math.round((qaMinutes * 60) / SECONDS_PER_EXCHANGE)));
}

const SEV_W = { high: 3, medium: 2, low: 1 } as const;

/** Greedy, round-robin assignment of focus targets so judges don't overlap. */
export function assignTargets(judges: QJudge[], targets: FocusTarget[], perJudge: number): Map<string, FocusTarget[]> {
  const out = new Map<string, FocusTarget[]>(judges.map((j) => [j.id, []]));
  const left = [...targets];
  for (let round = 0; round < perJudge; round++) {
    for (const j of judges) {
      if (!left.length) break;
      const aff = PERSONAS[j.temperament].affinity;
      let bi = 0;
      let bs = -1;
      left.forEach((t, i) => {
        const s = aff[t.kind] * SEV_W[t.severity] - i * 0.01;
        if (s > bs) {
          bs = s;
          bi = i;
        }
      });
      out.get(j.id)!.push(left.splice(bi, 1)[0]);
    }
  }
  return out;
}

export function clampDifficulty(d: number, t: QJudge["temperament"]): number {
  const [lo, hi] = PERSONAS[t].difficulty;
  const n = Math.round(Number.isFinite(d) ? d : lo);
  return Math.max(Math.max(1, lo - 1), Math.min(Math.min(5, hi + 1), n));
}

export function cleanQuestion(q: string): string {
  return q.replace(/\s+/g, " ").replace(/\(p\.\s*\d+[^)]*\)/g, "").trim();
}

function judgeUser(j: QJudge, judges: QJudge[], mine: FocusTarget[], others: Map<string, FocusTarget[]>, count: number, situation: string, avoid: string[] = []): string {
  const panel = judges.map((x) => `${x.name}(${TEMPERAMENT_LABEL[x.temperament]})`).join(", ");
  const otherLines = judges
    .filter((x) => x.id !== j.id)
    .map((x) => `- ${x.name}: ${(others.get(x.id) ?? []).map((t) => t.id).join(", ") || "(없음)"}`)
    .join("\n");
  return `심사위원단: ${panel}. 당신은 ${j.name}(${TEMPERAMENT_LABEL[j.temperament]})입니다.
상황 요약: ${situation.slice(0, 200) || "(없음)"}

당신에게 배정된 검토 포인트(우선 다룰 것): ${mine.map((t) => t.id).join(", ") || "(없음 — 전사와 자료에서 직접 고르세요)"}
다른 심사위원이 다룰 포인트(중복 금지):
${otherLines || "(없음)"}

서로 다른 주제의 질문 ${count}개를 중요한 순서대로 만드세요. 첫 질문이 가장 날카로워야 합니다(성향에 맞게).
배정 포인트가 질문 수보다 적으면 나머지는 전사·자료에서 다른 심사위원과 겹치지 않는 주제를 고르세요.${
    avoid.length
      ? `\n\n이전 연습에서 이미 나온 질문(같은 문장·같은 각도 반복 금지 — 같은 포인트라도 다른 측면이나 다른 근거로 물으세요):\n${avoid.slice(0, 20).map((q) => `- ${q}`).join("\n")}`
      : ""
  }
JSON으로만 답하세요.`;
}

function toQuestion(raw: QuestionOutT, j: QJudge, i: number, kind: GeneratedQuestion["kind"], latencyMs?: number): GeneratedQuestion {
  return {
    id: `q_${j.id}_${i + 1}`,
    judgeId: j.id,
    question: cleanQuestion(raw.question),
    intent: raw.intent.trim(),
    targetClaim: raw.targetClaim.trim(),
    targetId: raw.targetId && /^t\d+$/.test(raw.targetId) ? raw.targetId : null,
    evidence: raw.evidence.slice(0, 4).map((e) => ({ doc: e.doc, page: e.page == null ? null : Math.round(e.page), quote: e.quote.trim() })),
    difficulty: clampDifficulty(raw.difficulty, j.temperament),
    kind,
    latencyMs,
  };
}

/** Round-robin across judges; near-duplicate questions (or reused target ids) move to the reserve. */
export function orderQuestions(judges: QJudge[], byJudge: Map<string, GeneratedQuestion[]>, planned: number) {
  const queues = judges.map((j) => [...(byJudge.get(j.id) ?? [])]);
  const picked: GeneratedQuestion[] = [];
  const dup: GeneratedQuestion[] = [];
  const isDup = (q: GeneratedQuestion) =>
    picked.some((p) => similarity(p.question, q.question) > 0.5 || (q.targetId && p.targetId === q.targetId && p.judgeId !== q.judgeId) || similarity(p.targetClaim, q.targetClaim) > 0.7);
  while (queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (!next) continue;
      (isDup(next) ? dup : picked).push(next);
    }
  }
  const all = [...picked, ...dup];
  return { order: all.map((q) => q.id), main: all.slice(0, planned).map((q) => q.id), reserve: all.slice(planned).map((q) => q.id), duplicates: dup.map((q) => q.id) };
}

export interface GenerateOptions {
  onEvent?: (e: GenerateEvent) => void;
  signal?: AbortSignal;
  /** Reuse an already-built context (e.g. repeated runs in tests). */
  pack?: ContextPack;
}

export async function generateQuestions(input: GenerateInput, opts: GenerateOptions = {}): Promise<QuestionRun> {
  const emit = opts.onEvent ?? (() => {});
  if (new Set(input.judges.map((j) => j.id)).size !== input.judges.length) throw new Error("심사위원 id가 중복됩니다 (같은 얼굴을 두 번 고른 경우 다른 얼굴을 선택하세요)");
  const t0 = Date.now();
  const timings: Record<string, number> = {};

  emit({ type: "stage", stage: "context", msg: "컨텍스트 구성 중" });
  const pack = opts.pack ?? (await buildContext(input, (msg) => emit({ type: "stage", stage: "context", msg })));
  timings.context = opts.pack ? 0 : Date.now() - t0;
  const { text: _omit, ...packMeta } = pack;
  void _omit;
  emit({ type: "context", pack: { ...packMeta, preview: pack.text } });
  emit({ type: "stage", stage: "context", msg: `컨텍스트 ${pack.chars.toLocaleString()}자 (≈${pack.approxTokens.toLocaleString()} 토큰)`, ms: timings.context });

  const judges = input.judges;
  const planned = plannedQuestionCount(input.qaMinutes, input.questionCount);
  const perJudge = Math.min(4, Math.ceil(planned / judges.length) + 1);
  const assignment = assignTargets(judges, pack.targets, perJudge);
  const runId = newId("r");
  emit({ type: "plan", runId, plannedCount: planned, perJudge, assignments: judges.map((j) => ({ judgeId: j.id, targetIds: assignment.get(j.id)!.map((t) => t.id) })), provider: providerLabel("generate") });
  emit({ type: "stage", stage: "generate", msg: `심사위원 ${judges.length}명 병렬 질문 생성 (각 ${perJudge}개, 본질문 ${planned}개)` });

  const tGen = Date.now();
  const usage: LlmUsage[] = [];
  const byJudge = new Map<string, GeneratedQuestion[]>();
  const failures: string[] = [];
  const shared = `${SHARED_RULES}\n\n${pack.text}`;
  await Promise.all(
    judges.map(async (j) => {
      const sent: string[] = [];
      try {
        const tj = Date.now();
        const { data, usage: u } = await withRetry(() =>
          streamJson({
            role: "generate",
            name: "judge_questions",
            shared,
            persona: personaSystem(j.temperament, j),
            user: judgeUser(j, judges, assignment.get(j.id)!, assignment, perJudge, input.situation, input.avoidQuestions),
            schema: QuestionsOut,
            signal: opts.signal,
            onText: (acc) => {
              partialQuestions(acc).forEach((text, i) => {
                if (text && text !== sent[i]) {
                  sent[i] = text;
                  emit({ type: "delta", judgeId: j.id, index: i, text });
                }
              });
            },
          }),
        );
        usage.push(u);
        const qs = data.questions.slice(0, perJudge).map((q, i) => toQuestion(q, j, i, "main", Date.now() - tj));
        const grounded = await Promise.all(qs.map(async (q) => ({ ...q, evidence: await groundEvidence(q.evidence, { ...input, transcript: input.transcript }) })));
        byJudge.set(j.id, grounded);
        for (const q of grounded) emit({ type: "question", question: q });
        emit({ type: "judge-done", judgeId: j.id, usage: u, count: grounded.length });
      } catch (e) {
        byJudge.set(j.id, []);
        const why = friendlyError(e, "오류");
        failures.push(why);
        console.warn(`[question] ${j.name} generate failed:`, e instanceof Error ? e.message.slice(0, 300) : e);
        emit({ type: "error", judgeId: j.id, message: `${j.name} 질문 생성 실패: ${why}` });
      }
    }),
  );
  timings.generate = Date.now() - tGen;
  if (![...byJudge.values()].some((q) => q.length)) throw new Error(`모든 심사위원의 질문 생성이 실패했습니다. ${failures[0] ?? ""}`.trim());

  const ord = orderQuestions(judges, byJudge, planned);
  const questions = judges.flatMap((j) => byJudge.get(j.id) ?? []).map((q) => ({ ...q, kind: ord.main.includes(q.id) ? ("main" as const) : ("reserve" as const) }));
  timings.total = Date.now() - t0;

  const run: QuestionRun = {
    id: runId,
    createdAt: new Date().toISOString(),
    input,
    pack,
    questions,
    order: ord.order,
    main: ord.main,
    reserve: ord.reserve,
    usage,
    timings,
    qa: [],
  };
  await saveRun(run);
  emit({ type: "stage", stage: "done", msg: `완료: 질문 ${questions.length}개 (본 ${ord.main.length} · 예비 ${ord.reserve.length}${ord.duplicates.length ? ` · 중복 이동 ${ord.duplicates.length}` : ""})`, ms: timings.total });
  emit({ type: "done", runId, order: ord.order, main: ord.main, reserve: ord.reserve, timings, usage });
  return run;
}
