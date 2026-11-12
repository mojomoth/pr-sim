"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TEMPERAMENT_LABEL, type TranscriptSentence } from "@/lib/types";
import { useSentenceTranscriber } from "@/stt-tts/client/useSentenceTranscriber";
import { playWav, stopAll, type Playback } from "@/stt-tts/client/playWav";
import type { AnswerAssessment, ContextPack, GeneratedQuestion, GenerateEvent, LlmUsage, QJudge, TranscriptSource } from "../lib/types";
import { getSetup, ingestFixtures, judgeTts, listRunsApi, loadRunApi, postFollowup, saveSessionApi, streamGenerate, type RunSummary, type SetupData } from "./api";
import { ContextInspector } from "./ContextInspector";
import { JudgeEditor } from "./JudgeEditor";
import { EvidenceList, QuestionBubble } from "./QuestionBubble";
import { Button, Card, Chip, Face, ms, SectionTitle, Stat, Tag, TemperamentTag } from "./ui";

type PackView = Omit<ContextPack, "text"> & { preview: string };
type Phase = "setup" | "generating" | "ready" | "qa" | "finished";
interface LogEntry {
  questionId: string;
  judgeId: string;
  question: string;
  answer: string;
  askedAt: number;
  followup: boolean;
  assessment?: AnswerAssessment;
  decision?: "followup" | "next";
  remark?: string;
  latencyMs?: number;
}
interface Stage {
  msg: string;
  at: number;
  ms?: number;
}

const SEC_PER_Q = 55;
const fmtClock = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

export function QuestionStudio() {
  // ---------------- setup ----------------
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const [situation, setSituation] = useState("");
  const [qaMinutes, setQaMinutes] = useState(3);
  const [source, setSource] = useState<TranscriptSource>("sample-session");
  const [customText, setCustomText] = useState("");
  const [presDoc, setPresDoc] = useState<string>("");
  const [propDoc, setPropDoc] = useState<string>("");
  const [judges, setJudges] = useState<QJudge[]>([]);
  const [fastContext, setFastContext] = useState(false);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const presT = useSentenceTranscriber({ phase: "presentation" });

  const loadSetup = useCallback(async () => {
    try {
      const s = await getSetup();
      setSetup(s);
      setSituation((v) => v || s.sample.situation);
      setQaMinutes(s.sample.qaMinutes);
      setPresDoc((v) => v || s.defaults.presentationDocId || "");
      setPropDoc((v) => v || s.defaults.proposalDocId || "");
      setJudges((v) => (v.length ? v : s.sample.judges));
      setSetupErr(null);
    } catch (e) {
      setSetupErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  const transcript: TranscriptSentence[] = useMemo(() => {
    if (!setup) return [];
    if (source === "sample-session") return setup.sample.transcript;
    if (source === "script") return setup.script;
    if (source === "live") return presT.sentences.map(({ t, text }) => ({ t, text, phase: "presentation" as const }));
    let t = 0;
    return customText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text) => {
        const s = { t: Math.round(t), text, phase: "presentation" as const };
        t += text.length / 7.5 + 0.6;
        return s;
      });
  }, [setup, source, customText, presT.sentences]);

  // ---------------- generation ----------------
  const [phase, setPhase] = useState<Phase>("setup");
  const [stages, setStages] = useState<Stage[]>([]);
  const [pack, setPack] = useState<PackView | null>(null);
  const [plan, setPlan] = useState<Extract<GenerateEvent, { type: "plan" }> | null>(null);
  const [partials, setPartials] = useState<Record<string, string[]>>({});
  const [questions, setQuestions] = useState<Record<string, GeneratedQuestion>>({});
  const [done, setDone] = useState<Extract<GenerateEvent, { type: "done" }> | null>(null);
  const [genErrors, setGenErrors] = useState<string[]>([]);
  const [judgeUsage, setJudgeUsage] = useState<Record<string, LlmUsage>>({});
  const [firstMarks, setFirstMarks] = useState<{ delta?: number; question?: number }>({});
  const [runJudges, setRunJudges] = useState<QJudge[]>([]);
  const t0Ref = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const varyRef = useRef(true);
  const [vary, setVary] = useState(true);

  const judgeById = useCallback((id: string) => runJudges.find((j) => j.id === id) ?? judges.find((j) => j.id === id), [runJudges, judges]);

  const generate = async () => {
    if (!judges.length || !transcript.length) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    cancelSpeech();
    if (presT.status === "listening") await presT.stop();
    const avoidQuestions = varyRef.current ? Object.values(questions).filter((q) => q.kind !== "followup").map((q) => q.question) : [];
    setPhase("generating");
    setStages([]);
    setPack(null);
    setPlan(null);
    setPartials({});
    setQuestions({});
    setDone(null);
    setGenErrors([]);
    setJudgeUsage({});
    setFirstMarks({});
    resetQa();
    const snapJudges = judges.map((j) => ({ ...j }));
    setRunJudges(snapJudges);
    t0Ref.current = performance.now();
    requestAnimationFrame(() => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    const at = () => Math.round(performance.now() - t0Ref.current);
    let gotDone = false;
    try {
      await streamGenerate(
        {
          situation,
          qaMinutes,
          presentationMinutes: setup?.sample.presentationMinutes,
          transcript,
          presentationDocId: presDoc || undefined,
          proposalDocId: propDoc || undefined,
          judges: snapJudges,
          fastContext,
          ...(avoidQuestions.length ? { avoidQuestions } : {}),
        },
        (e) => {
          switch (e.type) {
            case "stage":
              setStages((s) => [...s, { msg: e.msg, at: at(), ms: e.ms }]);
              break;
            case "context":
              setPack(e.pack);
              break;
            case "plan":
              setPlan(e);
              break;
            case "delta":
              setFirstMarks((m) => (m.delta ? m : { ...m, delta: at() }));
              setPartials((p) => {
                const arr = [...(p[e.judgeId] ?? [])];
                arr[e.index] = e.text;
                return { ...p, [e.judgeId]: arr };
              });
              break;
            case "question":
              setFirstMarks((m) => (m.question ? m : { ...m, question: at() }));
              setQuestions((q) => ({ ...q, [e.question.id]: e.question }));
              break;
            case "judge-done":
              setJudgeUsage((u) => ({ ...u, [e.judgeId]: e.usage }));
              break;
            case "error":
              setGenErrors((x) => [...x, e.message]);
              break;
            case "done":
              gotDone = true;
              setDone(e);
              setQuestions((q) => {
                const n = { ...q };
                for (const id of e.reserve) if (n[id]) n[id] = { ...n[id], kind: "reserve" };
                for (const id of e.main) if (n[id]) n[id] = { ...n[id], kind: "main" };
                return n;
              });
              break;
          }
        },
        ac.signal,
      );
      // a stream that ends without "done" (every judge failed) goes back to setup so the error card + replay show
      setPhase((p) => (p === "generating" ? (gotDone ? "ready" : "setup") : p));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setGenErrors((x) => [...x, e instanceof Error ? e.message : String(e)]);
      setPhase("setup");
    }
  };

  // ---------------- Q&A ----------------
  const [queue, setQueue] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [current, setCurrent] = useState<GeneratedQuestion | null>(null);
  const [qaStart, setQaStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [answer, setAnswer] = useState("");
  const [answerBase, setAnswerBase] = useState("");
  const [pending, setPending] = useState(false);
  const [lastResult, setLastResult] = useState<{ assessment: AnswerAssessment; remark: string; decision: string; ms: number } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [ttsInfo, setTtsInfo] = useState<{ ms: number; cached: boolean; voice: string; model: string; provider: string; durationSec: number } | null>(null);
  const [ttsErr, setTtsErr] = useState<string | null>(null);
  const [autoVoice, setAutoVoice] = useState(true);
  const [qaErr, setQaErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; file: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const askedAtRef = useRef(0);
  const playRef = useRef<Playback | null>(null);
  const ansSentRef = useRef<string[]>([]);
  const ansT = useSentenceTranscriber({ phase: "qa", onSentence: (s) => ansSentRef.current.push(s.text) });

  function resetQa() {
    setQueue([]);
    setCursor(0);
    setCurrent(null);
    setQaStart(null);
    setLog([]);
    setAnswer("");
    setLastResult(null);
    setSaved(null);
    setQaErr(null);
    setTtsInfo(null);
    setTtsErr(null);
  }

  useEffect(() => {
    if (qaStart == null || phase !== "qa") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [qaStart, phase]);
  const elapsedSec = qaStart == null ? 0 : (now - qaStart) / 1000;
  const remainingSec = qaMinutes * 60 - elapsedSec;
  const timeUp = qaStart != null && remainingSec <= 0;

  // Every speak() takes a ticket. Asking another question, skipping, answering, starting the mic or
  // pressing 멈춤 bumps the counter, so a TTS fetch still in flight (Gemini first generation: 7–9 s)
  // is dropped when it lands instead of playing over the new question or into the open mic.
  const speakSeq = useRef(0);
  const micOnRef = useRef(false);
  const cancelSpeech = useCallback(() => {
    speakSeq.current++;
    playRef.current?.stop();
    playRef.current = null;
    stopAll();
    setSpeaking(false);
  }, []);
  const speak = useCallback(
    async (q: GeneratedQuestion, prefix?: string) => {
      const j = judgeById(q.judgeId);
      if (!j) return;
      const my = ++speakSeq.current;
      playRef.current?.stop();
      setTtsErr(null);
      setSpeaking(true);
      try {
        const clip = await judgeTts(prefix ? `${prefix} ${q.question}` : q.question, j);
        if (my !== speakSeq.current || micOnRef.current) return; // stale (question changed / mic on)
        setTtsInfo({ ms: clip.ms, cached: clip.cached, voice: clip.voice, model: clip.model, provider: clip.provider, durationSec: clip.durationSec });
        const pb = playWav(clip.blob);
        playRef.current = pb;
        await pb.done.catch(() => {});
      } catch (e) {
        if (my === speakSeq.current) setTtsErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (my === speakSeq.current) setSpeaking(false);
      }
    },
    [judgeById],
  );

  const ask = useCallback(
    (q: GeneratedQuestion, prefix?: string) => {
      cancelSpeech();
      setCurrent(q);
      setAnswer("");
      ansSentRef.current = [];
      askedAtRef.current = qaStart == null ? 0 : (Date.now() - qaStart) / 1000;
      if (autoVoice) void speak(q, prefix);
    },
    [autoVoice, speak, qaStart, cancelSpeech],
  );

  // bring the Q&A stage into view (on a phone it renders ~1000px above the generated-question list)
  const qaTopRef = useRef<HTMLDivElement>(null);
  const [scrollTick, setScrollTick] = useState(0);
  useEffect(() => {
    if (!scrollTick) return;
    requestAnimationFrame(() => qaTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [scrollTick]);

  const startQa = () => {
    if (!done) return;
    const q = questions[done.main[0]];
    if (!q) return;
    setQueue(done.main);
    setCursor(0);
    setLog([]);
    setLastResult(null);
    setSaved(null);
    const start = Date.now();
    setQaStart(start);
    setNow(start);
    setPhase("qa");
    cancelSpeech();
    setCurrent(q);
    setAnswer("");
    ansSentRef.current = [];
    askedAtRef.current = 0;
    setScrollTick((t) => t + 1);
    if (autoVoice) void speak(q);
  };

  const advance = (fromCursor = cursor, extraQueue = queue) => {
    const next = fromCursor + 1;
    cancelSpeech();
    if (timeUp || next >= extraQueue.length) {
      setCurrent(null);
      setPhase("finished");
      return;
    }
    setCursor(next);
    const q = questions[extraQueue[next]];
    if (q) ask(q);
  };

  const toggleMic = async () => {
    if (ansT.status === "listening" || ansT.status === "connecting") {
      await ansT.stop();
      micOnRef.current = false;
      const text = [answerBase, ...ansSentRef.current].filter(Boolean).join(" ").trim();
      setAnswer(text);
      return;
    }
    micOnRef.current = true; // before anything async: a TTS clip landing now must not play into the mic
    cancelSpeech();
    setAnswerBase(answer.trim());
    ansSentRef.current = [];
    ansT.reset();
    await ansT.start();
  };
  const micOn = ansT.status === "listening" || ansT.status === "connecting";
  useEffect(() => {
    // keep the ref in sync when the transcriber stops on its own (error / disconnect)
    if (ansT.status === "idle" || ansT.status === "error") micOnRef.current = false;
  }, [ansT.status]);
  const shownAnswer = micOn ? [answerBase, ...ansT.sentences.map((s) => s.text), ansT.partial].filter(Boolean).join(" ") : answer;

  const submitAnswer = async () => {
    if (!current || !done) return;
    let text = answer;
    if (micOn) {
      await ansT.stop();
      micOnRef.current = false;
      text = [answerBase, ...ansSentRef.current].filter(Boolean).join(" ").trim();
      setAnswer(text);
    }
    cancelSpeech();
    setPending(true);
    setQaErr(null);
    try {
      const r = await postFollowup({ runId: done.runId, judgeId: current.judgeId, questionId: current.id, answer: text, remainingSec: Math.max(0, remainingSec) });
      const entry: LogEntry = {
        questionId: current.id,
        judgeId: current.judgeId,
        question: current.question,
        answer: text,
        askedAt: Math.round(askedAtRef.current * 10) / 10,
        followup: current.kind === "followup",
        assessment: r.assessment,
        decision: r.decision,
        remark: r.remark,
        latencyMs: r.clientMs,
      };
      setLog((l) => [...l, entry]);
      setLastResult({ assessment: r.assessment, remark: r.remark, decision: r.decision, ms: r.clientMs });
      if (r.decision === "followup" && r.followup) {
        setQuestions((q) => ({ ...q, [r.followup!.id]: r.followup! }));
        ask(r.followup, r.remark);
      } else advance();
    } catch (e) {
      setQaErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const addReserve = () => {
    if (!done) return;
    const extra = done.reserve.filter((id) => !queue.includes(id));
    if (!extra.length) return;
    const nq = [...queue, ...extra];
    setQueue(nq);
    if (phase === "finished") {
      setPhase("qa");
      setCursor(queue.length);
      const q = questions[nq[queue.length]];
      if (q) ask(q);
      setScrollTick((t) => t + 1);
    }
  };

  const save = async () => {
    if (!done) return;
    setSaving(true);
    try {
      const r = await saveSessionApi({
        runId: done.runId,
        qa: log.map((x) => ({ questionId: x.questionId, judgeId: x.judgeId, question: x.question, answer: x.answer, askedAt: x.askedAt, followup: x.followup, assessment: x.assessment, decision: x.decision, remark: x.remark })),
      });
      setSaved({ id: r.id, file: r.file });
    } catch (e) {
      setQaErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // prefetch the next question's voice while the presenter answers — once per question, and never after a TTS error
  const prefetched = useRef(new Set<string>());
  useEffect(() => {
    if (phase !== "qa" || !autoVoice || speaking || ttsErr) return;
    const nextId = queue[cursor + 1];
    const q = nextId ? questions[nextId] : undefined;
    const j = q ? judgeById(q.judgeId) : undefined;
    if (!q || !j || prefetched.current.has(q.id)) return;
    prefetched.current.add(q.id);
    judgeTts(q.question, j).catch(() => {});
  }, [phase, autoVoice, speaking, ttsErr, queue, cursor, questions, judgeById]);

  // ---------------- replay a saved run (no AI calls) ----------------
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [replayId, setReplayId] = useState("");
  const [replayMsg, setReplayMsg] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const refreshRuns = useCallback(async () => {
    try {
      const r = await listRunsApi();
      setRuns(r);
      setReplayId((v) => v || r[0]?.id || "");
      return r;
    } catch (e) {
      setReplayMsg(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, []);
  useEffect(() => {
    if (replayOpen && runs == null) void refreshRuns();
  }, [replayOpen, runs, refreshRuns]);

  const replay = async (id: string) => {
    if (!id) return;
    setReplayMsg("불러오는 중…");
    try {
      const run = await loadRunApi(id);
      abortRef.current?.abort();
      cancelSpeech();
      resetQa();
      const { text, ...meta } = run.pack;
      setPack({ ...meta, preview: text });
      setRunJudges(run.input.judges);
      setQuestions(Object.fromEntries(run.questions.map((q) => [q.id, q])));
      setPartials({});
      setGenErrors([]);
      setFirstMarks({});
      setJudgeUsage({});
      const u = run.usage[0];
      setPlan({
        type: "plan",
        runId: run.id,
        plannedCount: run.main.length,
        perJudge: Math.max(...run.input.judges.map((j) => run.questions.filter((q) => q.judgeId === j.id && q.kind !== "followup").length)),
        assignments: run.input.judges.map((j) => ({ judgeId: j.id, targetIds: [...new Set(run.questions.filter((q) => q.judgeId === j.id && q.targetId).map((q) => q.targetId!))] })),
        provider: `저장된 실행 · ${u ? `${u.provider}:${u.model}` : "?"}`,
      });
      setDone({ type: "done", runId: run.id, order: run.order, main: run.main, reserve: run.reserve, timings: run.timings, usage: run.usage });
      setStages([{ msg: `저장된 실행 ${run.id} 불러옴 (${new Date(run.createdAt).toLocaleString("ko-KR")} 생성 · AI 호출 없음)`, at: 0 }]);
      setQaMinutes(run.input.qaMinutes);
      if (run.input.presentationDocId) setPresDoc(run.input.presentationDocId);
      if (run.input.proposalDocId) setPropDoc(run.input.proposalDocId);
      setPhase("ready");
      setReplayMsg(`불러옴: 질문 ${run.questions.filter((q) => q.kind !== "followup").length}개`);
      requestAnimationFrame(() => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setReplayMsg(`실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const replayLatest = async () => {
    const r = runs ?? (await refreshRuns());
    if (r[0]) await replay(r[0].id);
    else setReplayMsg("저장된 실행이 없습니다");
  };

  // ---------------- derived ----------------
  const docs = setup?.docs ?? [];
  const readyDocs = docs.filter((d) => d.state === "ready");
  const docIds = { presentation: presDoc || undefined, proposal: propDoc || undefined };
  const planned = Math.max(1, Math.min(10, Math.round((qaMinutes * 60) / SEC_PER_Q)));
  const orderIds = done?.order ?? Object.keys(questions);
  const genMs = done?.timings.total;
  const currentJudge = current ? judgeById(current.judgeId) : undefined;
  const busy = phase === "generating";

  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 pb-24 max-[360px]:px-5">
      <header className="flex h-14 items-center justify-between gap-3">
        <Link href="/" className="flex min-h-11 items-center gap-1 text-sm font-medium text-secondary" aria-label="PoC 허브로">
          ‹ 허브
        </Link>
        <h1 className="text-base font-semibold">심사 질문</h1>
        <Link href="/devlog" className="flex min-h-11 items-center text-sm text-secondary">
          devlog
        </Link>
      </header>
      <div className="mb-6 mt-2">
        <p className="text-[28px] font-bold leading-9 tracking-[-0.8px]">전사와 자료로 심사위원이 질문합니다</p>
        <p className="mt-2 text-secondary">발표 음성 전사 + 발표자료·제안자료 위키에서 근거를 찾아, 성향(친절함·빡셈·공격적)에 맞는 질문과 꼬리질문을 만듭니다.</p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ------------------------------ left: setup + context ------------------------------ */}
        <div className="space-y-6">
          <Card>
            <SectionTitle aside={setupErr ? <Tag tone="error">불러오기 실패</Tag> : !setup ? <Tag tone="line">불러오는 중</Tag> : null}>설정</SectionTitle>
            {setupErr ? (
              <p className="mb-3 text-sm text-error">
                {setupErr}{" "}
                <button className="underline" onClick={() => void loadSetup()}>
                  다시 시도
                </button>
              </p>
            ) : null}

            <label className="mb-1 block text-sm font-medium" htmlFor="situation">
              상황
            </label>
            <textarea id="situation" value={situation} onChange={(e) => setSituation(e.target.value)} rows={3} className="mb-4 w-full rounded-[16px] bg-canvas p-3 text-[15px] leading-6" />

            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between text-sm font-medium">
                <label htmlFor="qa-min">질의응답 시간</label>
                <span className="tabular text-secondary">
                  {qaMinutes}분 · 본질문 약 {planned}개
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="1분 줄이기" onClick={() => setQaMinutes((m) => Math.max(1, m - 1))} className="h-11 w-11 shrink-0 rounded-full bg-canvas text-lg">
                  −
                </button>
                <input id="qa-min" type="range" min={1} max={20} value={qaMinutes} onChange={(e) => setQaMinutes(Number(e.target.value))} className="w-full accent-[#111]" />
                <button type="button" aria-label="1분 늘리기" onClick={() => setQaMinutes((m) => Math.min(20, m + 1))} className="h-11 w-11 shrink-0 rounded-full bg-canvas text-lg">
                  +
                </button>
              </div>
            </div>

            <div className="mb-4">
              <div className="mb-2 text-sm font-medium">발표 전사</div>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="전사 출처">
                {(
                  [
                    ["sample-session", `샘플 전사 (${setup?.sample.transcript.length ?? "–"}문장)`],
                    ["script", `대본 전체 (${setup?.script.length ?? "–"}문장)`],
                    ["live", "마이크로 발표"],
                    ["custom", "직접 입력"],
                  ] as const
                ).map(([k, label]) => (
                  <Chip key={k} selected={source === k} role="radio" aria-checked={source === k} onClick={() => setSource(k)}>
                    {label}
                  </Chip>
                ))}
              </div>
              {source === "live" ? (
                <div className="mt-3 rounded-[16px] bg-canvas p-3">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant={presT.status === "listening" ? "primary" : "secondary"} onClick={() => void (presT.status === "listening" || presT.status === "connecting" ? presT.stop() : presT.start())}>
                      {presT.status === "listening" ? "■ 발표 녹음 종료" : presT.status === "connecting" ? "연결 중…" : "● 마이크 켜고 발표"}
                    </Button>
                    <span className="text-xs text-secondary">
                      {presT.sentences.length}문장 확정{presT.activeMode ? ` · ${presT.activeMode === "live" ? "Live" : "VAD"}` : ""}
                    </span>
                  </div>
                  {presT.error ? <p className="mt-2 text-sm text-error">{presT.error}</p> : null}
                  {presT.partial ? <p className="mt-2 text-sm text-secondary">음성 인식 중: {presT.partial}</p> : null}
                </div>
              ) : null}
              {source === "custom" ? (
                <textarea value={customText} onChange={(e) => setCustomText(e.target.value)} rows={5} placeholder="발표 내용을 한 줄에 한 문장씩 붙여 넣으세요" className="mt-3 w-full rounded-[16px] bg-canvas p-3 text-sm leading-6" aria-label="발표 전사 직접 입력" />
              ) : null}
              {transcript.length ? (
                <details className="mt-2">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm text-secondary">전사 {transcript.length}문장 미리보기</summary>
                  <ol className="max-h-56 space-y-1 overflow-auto rounded-[16px] bg-canvas p-3 text-sm">
                    {transcript.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="tabular shrink-0 text-xs leading-5 text-secondary">{fmtClock(s.t)}</span>
                        <span>{s.text}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : (
                <p className="mt-2 text-sm text-secondary">전사가 비어 있습니다.</p>
              )}
            </div>

            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm font-medium">
                <span>자료 (위키)</span>
                <button
                  type="button"
                  className="min-h-11 text-sm text-secondary underline underline-offset-2"
                  disabled={!!ingesting}
                  onClick={async () => {
                    setIngesting("샘플 PDF 위키 준비 중… (처음이면 2~3분)");
                    try {
                      const r = await ingestFixtures();
                      setPresDoc(r.presentationDocId);
                      setPropDoc(r.proposalDocId);
                      await loadSetup();
                      setIngesting(`준비 완료 (${r.reused.every(Boolean) ? "기존 위키 재사용" : "새로 인제스트"}, ${ms(r.ms)})`);
                    } catch (e) {
                      setIngesting(`실패: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }}
                >
                  샘플 PDF 위키 준비
                </button>
              </div>
              {ingesting ? <p className="mb-2 text-xs text-secondary">{ingesting}</p> : null}
              {(
                [
                  ["발표자료", presDoc, setPresDoc, "presentation"],
                  ["제안자료", propDoc, setPropDoc, "proposal"],
                ] as const
              ).map(([label, val, set, kind]) => (
                <label key={kind} className="mb-2 flex items-center gap-2 text-sm">
                  <span className="w-16 shrink-0 text-secondary">{label}</span>
                  <select value={val} onChange={(e) => set(e.target.value)} className="h-12 min-w-0 flex-1 rounded-[16px] bg-canvas px-3 text-[15px]">
                    <option value="">없음</option>
                    {readyDocs
                      .slice()
                      .sort((a, b) => (a.kind === kind ? -1 : 1) - (b.kind === kind ? -1 : 1))
                      .map((d) => (
                        <option key={d.docId} value={d.docId}>
                          {d.filename} · {d.pageCount}쪽{d.kind !== kind ? ` (${d.kind === "presentation" ? "발표" : "제안"}형)` : ""}
                        </option>
                      ))}
                  </select>
                  {val ? (
                    <a href={`/wiki?doc=${val}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-secondary underline">
                      위키
                    </a>
                  ) : null}
                </label>
              ))}
            </div>

            <div className="mb-4">
              <div className="mb-2 text-sm font-medium">심사위원 ({judges.length}/3)</div>
              <JudgeEditor judges={judges} faces={setup?.faces ?? []} onChange={setJudges} />
            </div>

            <label className="mb-4 flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={fastContext} onChange={(e) => setFastContext(e.target.checked)} className="h-5 w-5 accent-[#111]" />
              빠른 컨텍스트 (위키 lint 생략, 수치 비교만)
            </label>

            {Object.keys(questions).length ? (
              <label className="mb-3 flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={vary}
                  onChange={(e) => {
                    setVary(e.target.checked);
                    varyRef.current = e.target.checked;
                  }}
                  className="h-5 w-5 accent-[#111]"
                />
                다시 생성 시 이전 질문과 다른 각도로
              </label>
            ) : null}
            <Button size="lg" className="w-full" onClick={() => void generate()} disabled={!setup || busy || !judges.length || !transcript.length || judges.some((j) => !j.name.trim())}>
              {busy ? "질문 생성 중…" : phase === "setup" ? "질문 생성" : "다시 생성"}
            </Button>

            <details className="mt-3" open={replayOpen} onToggle={(e) => setReplayOpen((e.target as HTMLDetailsElement).open)} data-testid="replay">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-secondary">저장된 실행 불러오기 (AI 호출 없이 이전 결과 보기)</summary>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="replay-run">저장된 실행</label>
                <select id="replay-run" value={replayId} onChange={(e) => setReplayId(e.target.value)} className="h-12 min-w-0 flex-1 rounded-[16px] bg-canvas px-3 text-[15px]">
                  {runs == null ? <option value="">불러오는 중…</option> : !runs.length ? <option value="">저장된 실행 없음</option> : null}
                  {(runs ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {r.judges.map((j) => TEMPERAMENT_LABEL[j.temperament as keyof typeof TEMPERAMENT_LABEL] ?? j.temperament).join("/")} · 질문 {r.questions}
                      {r.provider ? ` · ${r.provider.split(":")[0]}` : ""}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void replay(replayId)} disabled={!replayId || busy} data-testid="replay-load">
                  불러오기
                </Button>
              </div>
              {replayMsg ? <p className="mt-2 text-xs text-secondary">{replayMsg}</p> : null}
            </details>
          </Card>

          {pack ? (
            <Card>
              <SectionTitle>컨텍스트 인스펙터</SectionTitle>
              <ContextInspector pack={pack} assignments={plan?.assignments} judgeName={(id) => judgeById(id)?.name ?? id} />
            </Card>
          ) : null}
        </div>

        {/* ------------------------------ right: stage ------------------------------ */}
        <div className="space-y-6" ref={stageRef}>
          {phase === "setup" && !genErrors.length ? (
            <Card className="bg-card">
              <p className="text-[20px] font-semibold leading-7">설정 후 “질문 생성”을 누르세요</p>
              <p className="mt-2 text-sm text-secondary">컨텍스트 구성 → 심사위원별 병렬 생성(실시간 스트리밍) → 원문 근거 검증 → 질의응답(음성·마이크) → 세션 저장 순서로 진행됩니다.</p>
            </Card>
          ) : null}

          {genErrors.length ? (
            <Card className="border border-error bg-canvas" data-testid="gen-errors">
              <div className="space-y-1">
                {genErrors.map((e, i) => (
                  <p key={i} className="break-words text-sm text-error [overflow-wrap:anywhere]">
                    {e}
                  </p>
                ))}
              </div>
              {!done && phase !== "generating" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void replayLatest()} data-testid="replay-latest">
                    최근 저장된 실행 불러오기
                  </Button>
                  <span className="text-xs text-secondary">질문·근거·인스펙터 화면은 이전 결과로 확인할 수 있습니다.</span>
                </div>
              ) : null}
            </Card>
          ) : null}

          <div ref={qaTopRef} className="scroll-mt-4 space-y-6 empty:hidden">
          {phase === "qa" || phase === "finished" ? (
            <Card className="bg-canvas p-0 sm:p-0" as="div">
              <div className="text-center">
                <div className="text-sm text-secondary">질의응답 남은 시간</div>
                <div className={`tabular text-[32px] font-semibold leading-10 tracking-[-1px] ${remainingSec < 30 ? "text-error" : ""}`} aria-live="off">
                  {fmtClock(remainingSec)}
                </div>
                <div className="mx-auto mt-2 h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden>
                  <div className="h-full bg-ink transition-[width]" style={{ width: `${Math.max(0, Math.min(100, (remainingSec / (qaMinutes * 60)) * 100))}%` }} />
                </div>
                {timeUp ? <p className="mt-2 text-sm text-error">시간이 끝났습니다. 현재 답변까지만 진행합니다.</p> : null}
              </div>
            </Card>
          ) : null}

          {phase === "qa" && current && currentJudge ? (
            <section className="space-y-4" data-testid="qa-stage">
              <div className="relative overflow-hidden rounded-[28px] bg-card">
                <Face name={currentJudge.name} imageUrl={currentJudge.imageUrl} rounded="rounded-none" className="aspect-[16/9] w-full lg:aspect-[2/1]" />
                <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-canvas px-4 py-2 text-[15px] font-semibold">
                  {currentJudge.name} · {TEMPERAMENT_LABEL[currentJudge.temperament]}
                </div>
                <div className="absolute bottom-4 right-4 rounded-full bg-canvas px-4 py-2 text-sm" aria-live="polite">
                  {speaking ? "▮▮▮ 질문 중" : pending ? "답변 검토 중…" : micOn ? "듣는 중" : "답변 대기"}
                </div>
              </div>
              {lastResult && current.kind === "followup" ? <p className="px-1 text-sm text-secondary">“{lastResult.remark}”</p> : null}
              <div className="rounded-[20px] bg-surface p-5">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-secondary">
                  {current.kind === "followup" ? "꼬리질문" : `심사위원 질문 ${cursor + 1}/${queue.length}`}
                  <span className="tabular">· 난이도 {current.difficulty}</span>
                </div>
                <p className="text-[20px] font-semibold leading-8 tracking-[-0.4px]" data-testid="current-question">
                  {current.question}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void speak(current)} disabled={speaking}>
                    {speaking ? "재생 중…" : "▶ 다시 듣기"}
                  </Button>
                  {speaking ? (
                    <Button size="sm" variant="secondary" onClick={cancelSpeech}>
                      ■ 멈춤
                    </Button>
                  ) : null}
                  {ttsInfo ? <span className="tabular text-xs text-secondary" data-testid="tts-info">
                      음성 {ttsInfo.voice} ({ttsInfo.provider === "openai" ? "OpenAI 폴백" : "Gemini"}) · {ttsInfo.cached ? "캐시" : ms(ttsInfo.ms)} · {ttsInfo.durationSec.toFixed(1)}초
                    </span> : null}
                </div>
                {ttsErr ? <p className="mt-2 text-sm text-error">음성 재생 실패: {ttsErr} (텍스트로 진행 가능)</p> : null}
                <details className="mt-2">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-secondary">근거 {current.evidence.length}개 보기</summary>
                  <p className="mb-2 text-sm text-secondary">{current.intent}</p>
                  <EvidenceList evidence={current.evidence} docIds={docIds} />
                </details>
              </div>

              <div className="ml-auto max-w-[92%] rounded-[20px] rounded-br-md bg-ink p-4 text-inverse outline-offset-2 outline-ink focus-within:outline-2 focus-within:outline">
                <div className="mb-1 text-xs opacity-80">내 답변 · {micOn ? "음성 인식 중" : shownAnswer ? "입력됨" : "말하거나 입력하세요"}</div>
                <textarea
                  value={shownAnswer}
                  onChange={(e) => setAnswer(e.target.value)}
                  readOnly={micOn}
                  rows={4}
                  placeholder="답변을 입력하거나 마이크로 말하세요"
                  aria-label="답변"
                  className="w-full resize-none bg-transparent text-[16px] leading-6 text-inverse placeholder:text-[#9a9a9a] focus:shadow-none focus:outline-none focus-visible:shadow-none focus-visible:outline-none"
                />
              </div>
              {ansT.error ? <p className="text-sm text-error">{ansT.error}</p> : null}
              {qaErr ? <p className="text-sm text-error">{qaErr}</p> : null}
              <div className="flex items-center gap-3 rounded-[28px] bg-surface p-3">
                <button type="button" onClick={() => void toggleMic()} aria-label={micOn ? "마이크 끄기" : "마이크로 답변"} className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl ${micOn ? "bg-ink text-inverse" : "bg-card"}`}>
                  {micOn ? (
                    "■"
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                    </svg>
                  )}
                </button>
                <div className="flex h-8 flex-1 items-center gap-[3px]" aria-hidden>
                  {Array.from({ length: 28 }, (_, i) => (
                    <span key={i} className="w-[3px] rounded-full bg-secondary" style={{ height: `${micOn ? 15 + Math.abs(Math.sin(i * 1.7 + now / 300)) * 85 * Math.max(0.15, ansT.level * 3) : 15}%` }} />
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={() => advance()} disabled={pending}>
                  건너뛰기
                </Button>
              </div>
              <Button size="lg" className="w-full" onClick={() => void submitAnswer()} disabled={pending || (!shownAnswer.trim() && !micOn)}>
                {pending ? "심사위원이 답변을 검토 중…" : "답변 완료 →"}
              </Button>
              {lastResult ? (
                <p className="text-sm text-secondary" data-testid="last-assessment">
                  직전 답변 평가: <b className="text-ink">{lastResult.assessment.verdict}</b> {lastResult.assessment.score}/5 · {lastResult.decision === "followup" ? "꼬리질문" : "다음 질문"} · {ms(lastResult.ms)} — {lastResult.assessment.reason}
                </p>
              ) : null}
            </section>
          ) : null}
          </div>

          {phase === "finished" ? (
            <Card className="bg-card">
              <p className="text-[20px] font-semibold">질의응답이 끝났습니다</p>
              <p className="mt-1 text-sm text-secondary">
                질문 {log.length}건에 답했습니다{lastResult ? ` · 마지막 반응 “${lastResult.remark}”` : ""}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {done && done.reserve.some((id) => !queue.includes(id)) ? (
                  <Button size="sm" variant="secondary" onClick={addReserve}>
                    예비 질문 더 받기
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : null}

          {phase !== "setup" ? (
            <Card>
              <SectionTitle>{phase === "generating" ? "질문 생성 중" : "생성된 질문"}</SectionTitle>
              {plan ? (
                <p className="-mt-1 mb-3 break-words text-xs text-secondary [overflow-wrap:anywhere]" data-testid="provider">
                  모델 {plan.provider}
                </p>
              ) : null}
              <ol className="mb-4 space-y-1 text-sm" aria-label="진행 단계" data-testid="stages">
                {stages.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="tabular w-14 shrink-0 text-right text-xs leading-5 text-secondary">{ms(s.at)}</span>
                    <span>{s.msg}</span>
                  </li>
                ))}
                {busy ? <li className="pl-16 text-secondary">…</li> : null}
              </ol>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="첫 글자" value={ms(firstMarks.delta)} sub="스트리밍 시작" />
                <Stat label="첫 질문 완성" value={ms(firstMarks.question)} />
                <Stat label="전체" value={ms(genMs)} sub={done ? `질문 ${Object.values(questions).filter((q) => q.kind !== "followup").length}개` : undefined} />
                <Stat label="본/예비" value={done ? `${done.main.length}/${done.reserve.length}` : "–"} sub={`계획 ${plan?.plannedCount ?? planned}개`} />
              </div>
              {phase === "ready" && done ? (
                <div className="mb-4 space-y-2">
                  <Button size="lg" className="w-full" onClick={startQa} data-testid="start-qa">
                    질의응답 시작 ({qaMinutes}분)
                  </Button>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={autoVoice} onChange={(e) => setAutoVoice(e.target.checked)} className="h-5 w-5 accent-[#111]" />
                    심사위원 음성으로 질문 읽기 (Gemini TTS · 한도 시 자동 폴백)
                  </label>
                </div>
              ) : null}
              <div className="space-y-3">
                {(runJudges.length ? runJudges : judges).map((j) => {
                  const mine = orderIds.filter((id) => questions[id]?.judgeId === j.id && questions[id].kind !== "followup").map((id) => questions[id]);
                  const parts = partials[j.id] ?? [];
                  const u = judgeUsage[j.id];
                  return (
                    <div key={j.id} className="rounded-[20px] bg-canvas p-3" data-testid="judge-questions">
                      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                        <Face name={j.name} imageUrl={j.imageUrl} className="h-10 w-10" />
                        <span className="font-semibold">{j.name}</span>
                        <TemperamentTag t={j.temperament} />
                        <span className="text-xs text-secondary">
                          {j.gender === "male" ? "남" : "여"} {j.age}세
                        </span>
                        {plan ? <span className="text-xs text-secondary">배정 {plan.assignments.find((a) => a.judgeId === j.id)?.targetIds.join(", ") || "없음"}</span> : null}
                        {u ? <span className="tabular ml-auto text-xs text-secondary">{ms(u.ms)} · 첫 토큰 {ms(u.ttftMs)} · 입력 {u.inputTokens.toLocaleString()}{u.cachedInputTokens ? `(캐시 ${u.cachedInputTokens.toLocaleString()})` : ""}</span> : null}
                      </div>
                      <div className="space-y-2">
                        {mine.length
                          ? mine.map((q) => <QuestionBubble key={q.id} q={q} judge={undefined} docIds={docIds} active={current?.id === q.id} compact />)
                          : parts.map((p, i) => <QuestionBubble key={i} partial={p} docIds={docIds} compact />)}
                        {!mine.length && !parts.length && busy ? <p className="px-1 text-sm text-secondary">컨텍스트를 읽는 중…</p> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {log.length ? (
            <Card>
              <SectionTitle
                aside={
                  <Button size="sm" onClick={() => void save()} disabled={saving} data-testid="save-session">
                    {saving ? "저장 중…" : "세션 저장"}
                  </Button>
                }
              >
                질의응답 기록
              </SectionTitle>
              {saved ? (
                <p className="mb-3 text-sm" data-testid="saved">
                  저장됨: <code className="text-xs">{saved.file}</code> ·{" "}
                  <a className="underline" href={`/api/question/sessions/${saved.id}`} target="_blank" rel="noreferrer">
                    JSON 보기
                  </a>
                </p>
              ) : null}
              <ol className="space-y-4">
                {log.map((x, i) => {
                  const j = judgeById(x.judgeId);
                  return (
                    <li key={i} className="space-y-2" data-testid="qa-log-item">
                      <div className="max-w-[92%] rounded-[20px] rounded-bl-md bg-canvas p-3">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
                          <span className="font-semibold text-ink">{j?.name}</span>
                          {j ? <TemperamentTag t={j.temperament} /> : null}
                          {x.followup ? <Tag tone="line">꼬리질문</Tag> : null}
                          <span className="tabular">{fmtClock(x.askedAt)}</span>
                        </div>
                        <p className="text-[15px] font-medium">{x.question}</p>
                      </div>
                      <div className="ml-auto max-w-[92%] rounded-[20px] rounded-br-md bg-ink p-3 text-inverse">
                        <p className="text-[15px]">{x.answer || "(답변 없음)"}</p>
                      </div>
                      {x.assessment ? (
                        <p className="text-xs text-secondary">
                          평가 <b className="text-ink">{x.assessment.verdict}</b> {x.assessment.score}/5 · {x.decision === "followup" ? "꼬리질문" : "다음"} · {ms(x.latencyMs)} — {x.assessment.reason}
                          {x.remark ? ` · “${x.remark}”` : ""}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}
