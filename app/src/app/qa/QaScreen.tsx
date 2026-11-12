"use client";
// 04 · 심사 / 질의응답. On entry the judges' questions are generated from the transcript and the
// documents (POST /api/questions, saved to the session). Then, per question: the judge asks (TTS,
// captions always shown), the presenter answers (STT), 답변 완료 → POST /api/questions/followup decides
// between a follow-up and the next question. Every exchange is saved to session.qa.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bubble } from "@/components/Bubble";
import { BottomBar, Button } from "@/components/Button";
import { ConfirmDialog, PhaseEndDialog } from "@/components/Dialog";
import { HeaderPill, StepHeader } from "@/components/Header";
import { Mic, MicOff, Refresh } from "@/components/Icons";
import { Screen } from "@/components/Layout";
import { Timer } from "@/components/Timer";
import { Waveform } from "@/components/Waveform";
import { ApiError, fetchTts, postFollowup, streamQuestions, ttsFallsBackToBrowser, type TtsResult } from "@/features/session/api";
import { getSession, updateSession } from "@/features/session/db";
import type { DocInput, GeneratedQuestion, QJudge, SessionRecord, StoredJudge, StoredQA, TranscriptSentence } from "@/features/session/types";
import { useCountdown, useSecondsOverride } from "@/features/session/useCountdown";
import { useSentenceTranscriber } from "@/features/stt/useSentenceTranscriber";
import { platform, type Playback } from "@/platform";
import { TEMPERAMENT_LABEL } from "@/server/types";
import { LoadFailed, LoadingScreen, MediaProblem, micStatusFromError, MissingSession, SessionJudgeAvatar, SessionJudgeHero, useSessionFromQuery } from "../present/shared";

export function QaScreen() {
  const s = useSessionFromQuery();
  const router = useRouter();
  const status = s.state === "ready" ? s.rec.status : undefined;
  const elsewhere = status === "setup" || status === "report" || status === "done";
  useEffect(() => {
    if (elsewhere) router.replace(status === "setup" ? `/present?s=${s.id}` : `/result?s=${s.id}`);
  }, [elsewhere, status, s.id, router]);
  if (s.state === "loading" || elsewhere) return <LoadingScreen />;
  if (s.state === "missing") return <MissingSession />;
  if (s.state === "error") return <LoadFailed onRetry={s.retry} />;
  return <QA key={s.rec.id} rec={s.rec} />;
}

type Stage = "preparing" | "prep-error" | "ready" | "asking" | "answering" | "judging" | "judge-error" | "save-error" | "ended";
/** `lite`: last-resort lite models that wrote these questions (kept with them so a resumed session still says so). */
type Bundle = NonNullable<SessionRecord["questions"]> & { lite?: string[] };
type Current = { q: GeneratedQuestion; original: GeneratedQuestion; remark?: string; n: number; of: number; judge: StoredQA["judge"] };
type Unsaved = { entry: StoredQA; followup?: GeneratedQuestion };
const SAVE_FAILED = "답변 기록을 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요.";
const DEVICE_VOICE = "AI 음성을 쓸 수 없어서 기기 음성으로 질문을 읽어 드려요.";
const liteModels = (models: string[]) => [...new Set(models.filter((m) => /lite/i.test(m)))];
/** The degraded-quality note (UI must say when a last-resort lite model wrote what the judge says). */
function liteText(lite: string[]) {
  return lite.length ? `주력 AI 모델을 쓸 수 없어서 경량 대체 모델(Google ${lite.join(", ")})이 질문을 만들거나 답변을 살폈어요. 평소보다 질문이 단순할 수 있어요.` : null;
}

const STAGE_TEXT: Record<string, string> = {
  context: "발표 내용과 자료를 살펴보고 있어요.",
  plan: "심사위원별로 질문할 주제를 나누고 있어요.",
  generate: "심사위원이 질문을 쓰고 있어요.",
  ground: "질문의 근거를 자료에서 확인하고 있어요.",
  done: "질문을 정리하고 있어요.",
};
const STAGE_PCT: Record<string, number> = { context: 8, plan: 30, generate: 35, ground: 92, done: 100 };
/** Main questions done but time left: continue with reserve questions only if this much is left. */
const RESERVE_MIN_SEC = 60;

function toDocInputs(rec: SessionRecord): DocInput[] {
  return [rec.docs.presentation, rec.docs.proposal].flatMap((d) =>
    d ? [{ role: d.role, docId: d.docId, filename: d.filename, pageTexts: d.pageTexts, ...(d.wikiState === "ready" && d.wiki ? { wiki: d.wiki, keyNumbers: d.keyNumbers } : {}) }] : [],
  );
}

function toQJudge(j: StoredJudge): QJudge {
  return { id: j.id, name: j.name, temperament: j.temperament, gender: j.gender, age: Math.round(j.age), fullName: j.fullName };
}

/** The same answer (a save retried after an unknown outcome must not add it twice). */
function sameEntry(a: StoredQA, b: StoredQA) {
  return a.questionId === b.questionId && a.askedAt === b.askedAt;
}

/** `cur` plus the sentences it is missing (their own saves failed). */
function withSentences(cur: TranscriptSentence[], all: TranscriptSentence[]) {
  const have = new Set(cur.map((x) => x.id));
  return [...cur, ...all.filter((x) => !have.has(x.id))];
}

function inTopic(questionId: string, original: GeneratedQuestion) {
  return questionId === original.id || questionId.startsWith(`${original.id}_f`);
}

function QA({ rec }: { rec: SessionRecord }) {
  const router = useRouter();
  const id = rec.id;
  const override = useSecondsOverride();
  const total = override ?? rec.setup.qaMinutes * 60;
  const resumeSec = !override && rec.resume?.phase === "qa" ? rec.resume.remainingSec : undefined;
  const judgeOf = useCallback((judgeId: string) => rec.judges.find((j) => j.id === judgeId), [rec]);

  const [stage, setStageState] = useState<Stage>(rec.questions?.main.length ? "ready" : "preparing");
  const [current, setCurrent] = useState<Current | null>(null);
  const [answer, setAnswer] = useState<TranscriptSentence[]>([]);
  const [log, setLog] = useState<StoredQA[]>(rec.qa);
  const [speaking, setSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  /** /api/tts failed (outage, quota, network): the judge speaks with the device voice for the rest of the session. */
  const [deviceVoice, setDeviceVoice] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lite, setLite] = useState<string[]>(() => (rec.questions as Bundle | undefined)?.lite ?? []);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [confirm, setConfirm] = useState<null | "exit" | "back">(null);
  const [endReason, setEndReason] = useState<null | "time" | "exhausted">(null);
  /** A required save failed: this retries it (and then continues where it stopped). */
  const [saveRetry, setSaveRetry] = useState<null | (() => void)>(null);
  const [prep, setPrep] = useState<{ stage: string; planned: number; got: Record<string, number>; failed: string[]; count: number; bundle?: Bundle | null }>(() => ({
    stage: "context",
    planned: 0,
    got: {},
    failed: [],
    count: rec.questions?.items.filter((q) => q.kind !== "followup").length ?? 0,
  }));

  // Engine state read by async flows (state values would be stale inside them).
  const E = useRef({
    stage: stage as Stage,
    bundle: rec.questions ?? null,
    items: new Map((rec.questions?.items ?? []).map((q) => [q.id, q])),
    pending: [] as string[],
    asked: 0,
    planned: 0,
    log: rec.qa,
    transcript: rec.transcript,
    current: null as Current | null,
    answer: [] as TranscriptSentence[],
    askedAt: 0,
    emptyWarned: false,
    collecting: false, // STT sentences belong to the current answer
    entry: null as StoredQA | null, // answered, waiting for the judge's decision
    unsaved: null as Unsaved | null, // judged, being saved (or its save failed)
    speakSeq: 0,
    playback: null as Playback | null,
    tts: new Map<string, Promise<TtsResult>>(),
    ttsProvider: undefined as "openai" | undefined,
    deviceVoice: false,
    followupAbort: null as AbortController | null,
    ended: false,
    micOn: true,
    started: false,
    paused: false, // a confirm sheet is open: the countdown and the transcriber both wait
    pausing: null as Promise<unknown> | null,
  });
  const setStage = useCallback(
    (st: Stage) => {
      E.current.stage = st;
      setStageState(st);
    },
    [],
  );

  // ── time ──
  const live = stage !== "preparing" && stage !== "prep-error" && stage !== "ready";
  const endRef = useRef<(r: "time" | "exhausted") => void>(() => {});
  const remaining = useCountdown(total, { running: live && stage !== "ended" && !confirm, initial: resumeSec, onEnd: () => endRef.current("time") });
  const remRef = useRef(remaining);
  useEffect(() => {
    remRef.current = remaining;
  }, [remaining]);
  const elapsed = useCallback(() => Math.max(0, total - remRef.current), [total]);

  const saveResume = useCallback(() => updateSession(id, { status: "qa", resume: { phase: "qa", remainingSec: Math.max(1, Math.ceil(remRef.current)) } }), [id]);
  useEffect(() => {
    if (!live || stage === "ended") return;
    const save = () => void saveResume().catch(() => {});
    const t = window.setInterval(save, 5000);
    const onHide = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [live, stage, saveResume]);

  // ── STT: answer sentences ── (a failed write here is repaired by the next record/end/leave save)
  const onSentence = useCallback(
    (x: TranscriptSentence) => {
      E.current.transcript = [...E.current.transcript, x];
      updateSession(id, (cur) => ({ ...cur, transcript: [...cur.transcript, x] })).catch(() => {});
      if (E.current.collecting) {
        E.current.answer = [...E.current.answer, x];
        setAnswer(E.current.answer);
      }
    },
    [id],
  );
  const stt = useSentenceTranscriber({ phase: "qa", onSentence });
  const { start: sttStart, stop: sttStop } = stt;
  const answerRef = useRef<HTMLDivElement>(null);
  const answerBoxRef = useRef<HTMLDivElement>(null);
  /** When the presenter last scrolled by hand: following the answer pauses for a few seconds after. */
  const userScrollAt = useRef(0);
  useEffect(() => {
    const sc = document.getElementById("app-scroll");
    if (!sc) return;
    const mark = () => (userScrollAt.current = Date.now());
    const onKey = (e: KeyboardEvent) => ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key) && mark();
    sc.addEventListener("wheel", mark, { passive: true });
    sc.addEventListener("touchmove", mark, { passive: true });
    sc.addEventListener("keydown", onKey);
    return () => {
      sc.removeEventListener("wheel", mark);
      sc.removeEventListener("touchmove", mark);
      sc.removeEventListener("keydown", onKey);
    };
  }, []);
  const saveAlertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (saveRetry) saveAlertRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [saveRetry]);
  const sttStopRef = useRef(sttStop);
  useEffect(() => {
    sttStopRef.current = sttStop;
  }, [sttStop]);

  // ── 1. generate the questions ──
  const generate = useCallback(async () => {
    setStage("preparing");
    setError(null);
    const fresh = (await getSession(id).catch(() => undefined)) ?? rec;
    E.current.transcript = fresh.transcript;
    const docs = toDocInputs(fresh);
    if (!docs.length || !fresh.judges.length) {
      setError(!docs.length ? "발표 자료가 없어 질문을 만들 수 없어요. 상황 설정에서 자료를 올려 주세요." : "심사위원이 없어 질문을 만들 수 없어요. 상황 설정에서 심사위원을 추가해 주세요.");
      setStage("prep-error");
      return;
    }
    const reuse = prep.bundle; // context pack from a run that produced no questions: skip the context step
    setPrep((p) => ({ ...p, stage: reuse ? "generate" : "context", got: {}, failed: [], count: 0 }));
    try {
      const done = await streamQuestions(
        {
          situation: fresh.setup.situation,
          qaMinutes: Math.max(1, Math.min(20, fresh.setup.qaMinutes)),
          presentationMinutes: Math.max(1, Math.min(30, fresh.setup.presentationMinutes)),
          transcript: fresh.transcript.filter((x) => x.phase === "presentation").slice(-2000),
          docs,
          judges: fresh.judges.map(toQJudge),
          ...(reuse ? { pack: reuse.pack, lint: reuse.lint } : {}),
        },
        {
          onEvent: (ev) => {
            if (ev.type === "stage") setPrep((p) => ({ ...p, stage: ev.stage }));
            else if (ev.type === "plan") setPrep((p) => ({ ...p, planned: ev.plannedCount }));
            else if (ev.type === "question") setPrep((p) => ({ ...p, count: p.count + 1, got: { ...p.got, [ev.question.judgeId]: (p.got[ev.question.judgeId] ?? 0) + 1 } }));
            else if (ev.type === "error" && ev.judgeId) setPrep((p) => ({ ...p, failed: [...p.failed, ev.judgeId!] }));
          },
        },
      );
      const genLite = done.degraded ? liteModels(done.usage.map((u) => u.model)) : [];
      const bundle: Bundle = { pack: done.pack, lint: done.lint, items: done.questions, order: done.order, main: done.main, reserve: done.reserve, ...(genLite.length ? { lite: genLite } : {}) };
      if (!done.main.length) {
        setPrep((p) => ({ ...p, bundle }));
        setError("질문을 만들지 못했어요. 다시 시도해 주세요.");
        setStage("prep-error");
        return;
      }
      E.current.bundle = bundle;
      E.current.items = new Map(bundle.items.map((q) => [q.id, q]));
      await updateSession(id, { status: "qa", questions: bundle });
      setPrep((p) => ({ ...p, stage: "done", bundle: null, count: bundle.items.length }));
      setLite(genLite);
      if (!E.current.ended) setStage("ready");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "질문을 만들지 못했어요. 다시 시도해 주세요.");
      setStage("prep-error");
    }
  }, [id, rec, prep.bundle, setStage]);

  const startedGen = useRef(false);
  useEffect(() => {
    if (startedGen.current || E.current.bundle?.main.length) return;
    startedGen.current = true;
    void generate();
  }, [generate]);

  // ── 2. ask / listen / judge ──
  const tts = useCallback(
    (q: GeneratedQuestion, prefix?: string) => {
      const key = prefix ? `${q.id}+remark` : q.id;
      let p = E.current.tts.get(key);
      const j = judgeOf(q.judgeId);
      if (!p && j) {
        const body = {
          text: (prefix ? `${prefix} ${q.question}` : q.question).slice(0, 1200),
          gender: j.gender,
          age: Math.max(20, Math.min(70, Math.round(j.age))),
          temperament: j.temperament,
          ...(E.current.ttsProvider ? { provider: E.current.ttsProvider } : {}),
        };
        p = fetchTts(body).then((r) => {
          if (r.provider === "openai") E.current.ttsProvider = "openai"; // keep each judge's voice the same for the rest of the session
          return r;
        });
        p.catch(() => E.current.tts.delete(key));
        E.current.tts.set(key, p);
      }
      return p ?? Promise.reject(new Error("심사위원 정보를 찾지 못했어요."));
    },
    [judgeOf],
  );

  const listen = useCallback(() => {
    if (E.current.ended) return;
    setStage("answering");
    if (E.current.micOn && !E.current.paused) void sttStart(elapsed());
    const nextId = E.current.pending[0];
    const next = nextId ? E.current.items.get(nextId) : undefined;
    if (next && !E.current.deviceVoice) tts(next).catch(() => {}); // prefetch the next question's voice while the presenter answers
  }, [elapsed, setStage, sttStart, tts]);

  const cancelSpeech = useCallback(() => {
    E.current.speakSeq++;
    E.current.playback?.stop();
    E.current.playback = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (q: GeneratedQuestion, prefix?: string) => {
      if (E.current.ended) return;
      const my = ++E.current.speakSeq;
      E.current.playback?.stop();
      setTtsError(null);
      setSpeaking(true);
      const j = judgeOf(q.judgeId);
      let clip: TtsResult | null = null;
      if (!E.current.deviceVoice) {
        try {
          clip = await tts(q, prefix);
        } catch (err) {
          if (my !== E.current.speakSeq) return;
          if (!j || !platform.audio.canSpeak() || !ttsFallsBackToBrowser(err)) {
            setSpeaking(false);
            setTtsError(err instanceof ApiError ? err.message : "질문 음성을 만들지 못했어요. 질문을 읽고 답변해 주세요.");
            listen();
            return;
          }
          // Sticky like the OpenAI pin: one voice per judge, and no slow failing call before every question.
          E.current.deviceVoice = true;
          setDeviceVoice(true);
        }
      }
      if (my !== E.current.speakSeq) return;
      try {
        const pb = clip ? platform.audio.play(clip.blob) : j ? platform.audio.speak(prefix ? `${prefix} ${q.question}` : q.question, j) : null;
        if (!pb) throw new Error("심사위원 정보를 찾지 못했어요.");
        E.current.playback = pb;
        await pb.done;
      } catch (err) {
        if (my === E.current.speakSeq) setTtsError(`${(err as Error).message} ‘질문 다시 듣기’를 누르면 다시 들려 드려요.`);
      }
      if (my !== E.current.speakSeq) return;
      E.current.playback = null;
      setSpeaking(false);
      listen();
    },
    [judgeOf, tts, listen],
  );

  // Leaving the page (browser Back, logo link) mid-flow: a pending TTS fetch or judge decision must
  // not play the voice or open the mic on the next page. `ended` makes every async flow bail out.
  useEffect(() => {
    const e = E.current;
    e.ended = false; // StrictMode re-mount after the simulated unmount below
    return () => {
      e.ended = true;
      cancelSpeech();
      platform.audio.stopAll();
      e.followupAbort?.abort();
      void sttStopRef.current().catch(() => {});
    };
  }, [cancelSpeech]);

  const ask = useCallback(
    (q: GeneratedQuestion, original: GeneratedQuestion, remark?: string, carry: TranscriptSentence[] = []) => {
      const j = judgeOf(q.judgeId);
      if (E.current.ended || !j) return;
      if (q === original) E.current.asked++;
      const cur: Current = { q, original, remark, n: E.current.asked, of: Math.max(E.current.planned, E.current.asked), judge: { id: j.id, name: j.name, temperament: j.temperament } };
      E.current.current = cur;
      E.current.answer = carry; // resumed: what was already said for this question
      E.current.collecting = true;
      E.current.emptyWarned = false;
      E.current.entry = null;
      E.current.askedAt = elapsed();
      setCurrent(cur);
      setAnswer(carry);
      setNotice(null);
      setError(null);
      setStage("asking");
      void speak(q, remark);
    },
    [elapsed, judgeOf, setStage, speak],
  );

  /** Save one answered question (and a follow-up it produced). Resolves false if storage failed. */
  const record = useCallback(
    async (entry: StoredQA, followup?: GeneratedQuestion) => {
      if (followup) E.current.items.set(followup.id, followup);
      try {
        await updateSession(id, (cur) => ({
          ...cur,
          transcript: withSentences(cur.transcript, E.current.transcript),
          qa: cur.qa.some((x) => sameEntry(x, entry)) ? cur.qa : [...cur.qa, entry],
          ...(followup && cur.questions && !cur.questions.items.some((x) => x.id === followup.id) ? { questions: { ...cur.questions, items: [...cur.questions.items, followup] } } : {}),
        }));
      } catch {
        return false;
      }
      if (!E.current.log.some((x) => sameEntry(x, entry))) {
        E.current.log = [...E.current.log, entry];
        setLog(E.current.log);
      }
      return true;
    },
    [id],
  );

  /** record(), then `then()`; a failed save stays on this question with a retry (never moves on silently). */
  const commit = useCallback(
    async (u: Unsaved, then: () => void) => {
      E.current.unsaved = u; // end()/leave() save it if they run meanwhile
      const attempt = async () => {
        setSaveRetry(null);
        const ok = await record(u.entry, u.followup);
        if (E.current.ended) return;
        if (ok) {
          E.current.unsaved = null;
          setError(null);
          return then();
        }
        setError(SAVE_FAILED);
        setStage("save-error");
        setSaveRetry(() => () => void attempt());
      };
      await attempt();
    },
    [record, setStage],
  );

  const end = useCallback(
    async (reason: "time" | "exhausted") => {
      if (E.current.ended) return;
      E.current.ended = true;
      setStage("ended");
      cancelSpeech();
      platform.audio.stopAll();
      E.current.followupAbort?.abort();
      await E.current.pausing;
      await sttStop();
      // keep an answer the time ran out on (no judgement)
      const c = E.current.current;
      let last: Unsaved | null =
        E.current.unsaved ??
        (E.current.entry ? { entry: E.current.entry } : c && E.current.collecting && E.current.answer.length ? { entry: answerEntry(c, E.current.answer, E.current.askedAt) } : null);
      E.current.unsaved = null;
      E.current.entry = null;
      E.current.collecting = false;
      // Only a saved session moves on to the result; otherwise stay with a retry.
      const save = async () => {
        setSaveRetry(null);
        let ok = !last || (await record(last.entry, last.followup));
        if (ok) {
          last = null;
          ok = await updateSession(id, (cur) => ({ ...cur, transcript: withSentences(cur.transcript, E.current.transcript), status: "report", resume: undefined })).then(
            () => true,
            () => false,
          );
        }
        if (!ok) {
          setError(SAVE_FAILED);
          setSaveRetry(() => () => void save());
          return;
        }
        setError(null);
        setEndReason(reason);
      };
      await save();
    },
    [id, cancelSpeech, record, setStage, sttStop],
  );
  useEffect(() => {
    endRef.current = (r) => void end(r);
  });

  const nextQuestion = useCallback((carry?: TranscriptSentence[]) => {
    const b = E.current.bundle;
    if (!b) return;
    let nextId = E.current.pending.shift();
    if (!nextId && remRef.current > RESERVE_MIN_SEC) {
      const asked = new Set(E.current.log.map((x) => x.questionId));
      E.current.pending = b.reserve.filter((rid) => !asked.has(rid) && rid !== E.current.current?.original.id);
      E.current.planned += E.current.pending.length;
      nextId = E.current.pending.shift();
    }
    const q = nextId ? E.current.items.get(nextId) : undefined;
    if (!q) return void end("exhausted");
    ask(q, q, undefined, carry);
  }, [ask, end]);

  const judgeAnswer = useCallback(
    async (entry: StoredQA) => {
      const c = E.current.current;
      const b = E.current.bundle;
      const judge = c && judgeOf(c.q.judgeId);
      if (!c || !b || !judge) return;
      setStage("judging");
      setError(null);
      const ctrl = new AbortController();
      E.current.followupAbort = ctrl;
      try {
        const r = await postFollowup(
          {
            packText: b.pack.text,
            judge: toQJudge(judge),
            asked: c.q,
            original: c.original,
            answer: entry.answer,
            thread: E.current.log.filter((x) => inTopic(x.questionId, c.original)).map((x) => ({ question: x.question, answer: x.answer })).slice(-6),
            followupsSoFar: [...E.current.items.values()].filter((q) => q.parentId === c.original.id).length,
            remainingSec: Math.max(0, Math.round(remRef.current)),
            pending: E.current.pending.flatMap((pid) => E.current.items.get(pid) ?? []).slice(0, 30),
            transcript: E.current.transcript.slice(-2000),
            docs: toDocInputs(rec).map((d) => ({ role: d.role, pageTexts: d.pageTexts })),
          },
          ctrl.signal,
        );
        if (E.current.ended) return;
        if (r.degraded) setLite((l) => liteModels([...l, r.usage.model]));
        E.current.entry = null;
        const followup = r.decision === "followup" && r.followup ? r.followup : undefined;
        await commit({ entry: { ...entry, assessment: r.assessment, decision: r.decision, remark: r.remark }, followup }, () => (followup ? ask(followup, c.original, r.remark) : nextQuestion()));
      } catch (err) {
        if (E.current.ended || (err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof ApiError ? err.message : "답변을 확인하지 못했어요. 다시 시도해 주세요.");
        setStage("judge-error");
      } finally {
        if (E.current.followupAbort === ctrl) E.current.followupAbort = null;
      }
    },
    [ask, commit, judgeOf, nextQuestion, rec, setStage],
  );

  const submit = async () => {
    const c = E.current.current;
    if (!c || E.current.stage !== "answering") return;
    setStage("judging");
    await sttStop();
    if (E.current.ended) return; // left the page while the last words were being finalized
    const text = E.current.answer.map((x) => x.text).join(" ").trim();
    if (!text && !E.current.emptyWarned) {
      E.current.emptyWarned = true;
      setNotice("아직 인식된 답변이 없어요. 다시 말씀해 주세요. 이대로 넘어가려면 ‘답변 완료’를 한 번 더 누르세요.");
      listen();
      return;
    }
    setNotice(null);
    E.current.collecting = false;
    E.current.entry = answerEntry(c, E.current.answer, E.current.askedAt);
    void judgeAnswer(E.current.entry);
  };

  const skipAfterError = () => {
    const entry = E.current.entry;
    E.current.entry = null;
    if (entry) void commit({ entry }, () => nextQuestion());
    else nextQuestion();
  };

  const startQa = () => {
    const b = E.current.bundle;
    if (!b || E.current.started) return;
    E.current.started = true;
    platform.audio.unlock(); // inside the tap, so the judge's voice can autoplay
    const asked = new Set(E.current.log.map((x) => x.questionId));
    E.current.pending = b.main.filter((qid) => !asked.has(qid));
    if (!E.current.pending.length) E.current.pending = b.reserve.filter((qid) => !asked.has(qid));
    E.current.asked = new Set(E.current.log.filter((x) => !x.followup).map((x) => x.questionId)).size;
    E.current.planned = E.current.asked + E.current.pending.length;
    void saveResume().catch(() => {});
    // Resumed mid-question: the words already said after the last saved answer belong to the question
    // that was open (asked again first: a pending follow-up, else the next queued question).
    const used = new Set(E.current.log.flatMap((x) => x.answerSentenceIds));
    const qaSaid = E.current.transcript.filter((x) => x.phase === "qa");
    let after = qaSaid.length;
    while (after > 0 && !used.has(qaSaid[after - 1].id)) after--;
    const carry = qaSaid.slice(after);
    // A follow-up is saved with the answer that produced it; one without an answer was still open.
    const followup = [...E.current.items.values()].filter((q) => q.kind === "followup" && !asked.has(q.id)).at(-1);
    if (followup) {
      const original = (followup.parentId && E.current.items.get(followup.parentId)) || followup;
      const prev = E.current.log.at(-1);
      return ask(followup, original, prev?.decision === "followup" ? prev.remark : undefined, carry);
    }
    nextQuestion(carry);
  };

  const replay = async () => {
    const c = E.current.current;
    if (!c || (E.current.stage !== "answering" && E.current.stage !== "asking")) return;
    platform.audio.unlock();
    setStage("asking");
    await stt.stop();
    void speak(c.q, c.remark);
  };

  // A confirm sheet pauses the countdown, so it pauses the transcriber too (otherwise words spoken
  // meanwhile get times past the clock, and sentences after it resumes go back in time).
  const openConfirm = (kind: "exit" | "back") => {
    setConfirm(kind);
    E.current.paused = true;
    if (E.current.stage === "answering" && E.current.micOn && !E.current.pausing) E.current.pausing = sttStop();
  };
  const closeConfirm = async () => {
    setConfirm(null);
    E.current.paused = false;
    await E.current.pausing;
    E.current.pausing = null;
    if (!E.current.ended && !E.current.paused && E.current.stage === "answering" && E.current.micOn) void sttStart(elapsed());
  };

  const toggleMic = () => {
    const on = !E.current.micOn;
    E.current.micOn = on;
    setMicOn(on);
    if (!on) return void stt.stop();
    if (E.current.stage === "asking") {
      cancelSpeech(); // answer right away instead of listening to the rest of the question
      listen();
    } else if (E.current.stage === "answering") void stt.start(elapsed());
  };

  const leave = async () => {
    setConfirm(null);
    if (!live || E.current.ended) return router.push("/history");
    E.current.ended = true;
    setStage("ended");
    cancelSpeech();
    platform.audio.stopAll();
    E.current.followupAbort?.abort();
    await E.current.pausing;
    await stt.stop();
    // answered but not judged (or judged but not saved yet); an unfinished answer stays in the transcript
    let last: Unsaved | null = E.current.unsaved ?? (E.current.entry ? { entry: E.current.entry } : null);
    E.current.unsaved = null;
    E.current.entry = null;
    const save = async () => {
      setSaveRetry(null);
      let ok = !last || (await record(last.entry, last.followup));
      if (ok) {
        last = null;
        ok = await updateSession(id, (cur) => ({
          ...cur,
          transcript: withSentences(cur.transcript, E.current.transcript),
          status: "qa",
          resume: { phase: "qa", remainingSec: Math.max(1, Math.ceil(remRef.current)) },
        })).then(
          () => true,
          () => false,
        );
      }
      if (!ok) {
        setError(SAVE_FAILED);
        setSaveRetry(() => () => void save());
        return;
      }
      router.push("/history");
    };
    await save();
  };

  // ── view ──
  const judge = current ? judgeOf(current.q.judgeId) : undefined;
  const listening = stt.status === "listening";
  const answerText = [...answer.map((x) => x.text), ...stt.partialSentences].join(" ");
  const answerState = !micOn ? "마이크 꺼짐" : stt.status === "connecting" ? "연결 중" : listening ? "음성 인식 중" : stage === "judging" ? "답변 완료" : undefined;
  const showMicRow = live && stage !== "ended";
  // Keep the live answer in view while it is transcribed: newest line visible inside the bubble, and the
  // bubble itself above the fixed mic row (#app-scroll's scroll-padding-bottom clears the bottom bar).
  const following = stage === "answering" || stage === "judging";
  useEffect(() => {
    if (!following) return;
    const box = answerBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
    if (Date.now() - userScrollAt.current < 4000) return;
    answerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [following, answerText]);

  return (
    <>
      <Screen bottomPad={showMicRow ? 132 : 72}>
        {/* DESIGN.md: the step name and the remaining time stay at the top (the logo row scrolls away). */}
        <div className="sticky -top-12 z-20 -mx-[var(--gutter)] bg-canvas px-[var(--gutter)] pb-2">
          <StepHeader title="질의응답" onBack={live && stage !== "ended" ? () => openConfirm("back") : () => router.push("/history")} right={<HeaderPill onClick={() => (live && stage !== "ended" ? openConfirm("exit") : router.push("/history"))}>종료</HeaderPill>} />
          <Timer label={resumeSec ? "질의응답 남은 시간 · 이어서 진행" : "질의응답 남은 시간"} remaining={remaining} total={total} compact />
        </div>

        {!live ? (
          <Prep rec={rec} stage={stage} prep={prep} error={error} resumed={log.length > 0} note={liteText(lite)} />
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {judge && current && (
              // No fade/opacity on the photo (it must stay full strength). Once Q&A is over the hero's
              // 질문 중 / 답변 듣는 중 pill is hidden: nobody is asking or listening any more.
              <div className={`h-[clamp(180px,calc(var(--app-h)-590px),300px)] [&>div]:aspect-auto [&>div]:h-full ${stage === "ended" ? "[&_[aria-live]]:hidden" : ""}`}>
                <SessionJudgeHero judge={judge} speaking={speaking || stage === "asking"} />
              </div>
            )}
            {current && (
              <Bubble label={current.q.kind === "followup" ? "꼬리질문" : "심사위원 질문"} status={<span className="tabular">{`${current.n} / ${current.of}`}</span>} live>
                {current.remark && <span className="mb-1 block text-[15px] font-normal leading-[22px] text-secondary">{current.remark}</span>}
                <span className="text-[18px] font-semibold leading-[27px]">{current.q.question}</span>
              </Bubble>
            )}
            {(ttsError || deviceVoice || stage === "answering") && current && (
              <div className="flex items-center justify-between gap-3 px-1">
                <p className="min-w-0 text-[13px] leading-[18px] text-secondary">{ttsError ?? (deviceVoice ? DEVICE_VOICE : "질문을 다시 들을 수 있어요.")}</p>
                <button type="button" onClick={() => void replay()} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 text-[14px] font-semibold">
                  <Refresh size={16} /> 질문 다시 듣기
                </button>
              </div>
            )}
            {liteText(lite) && (
              <p className="px-1 text-[13px] leading-[18px] text-secondary" role="note">
                {liteText(lite)}
              </p>
            )}
            {stage !== "asking" && current && (
              <div ref={answerRef} className="scroll-mb-4">
                {/* Draft 04: the answer sits right above the mic row. The text keeps its latest lines in
                    view (capped height, pinned to the end) so the question above stays on screen too. */}
                <Bubble variant="me" label="내 답변" status={answerState} className="ui-enter">
                  <div ref={answerBoxRef} className="max-h-[156px] overflow-y-auto overscroll-contain [scrollbar-width:none]">
                    {answerText || <span className="text-inverse/60">{micOn ? "답변을 말씀해 주세요…" : "마이크를 켜고 답변해 주세요."}</span>}
                    {listening && <span className="ui-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] bg-inverse" aria-hidden="true" />}
                  </div>
                </Bubble>
              </div>
            )}
            {stage === "judging" && judge && (
              <p className="text-center text-[14px] text-secondary" role="status">
                {judge.name} 심사위원이 답변을 살펴보고 있어요…
              </p>
            )}
            {saveRetry && error && (
              <div ref={saveAlertRef} role="alert" className="scroll-mb-[150px] flex flex-col gap-3 rounded-[20px] border border-line p-4">
                <p className="text-[14px] leading-5 text-error">{error}</p>
                <Button size="md" onClick={saveRetry}>
                  다시 시도
                </Button>
              </div>
            )}
            {stage === "judge-error" && error && (
              <div role="alert" className="flex flex-col gap-3 rounded-[20px] border border-line p-4">
                <p className="text-[14px] leading-5 text-error">{error}</p>
                <div className="flex gap-2">
                  <Button size="md" className="flex-1" onClick={() => E.current.entry && void judgeAnswer(E.current.entry)}>
                    다시 시도
                  </Button>
                  <Button size="md" variant="secondary" className="flex-1" onClick={skipAfterError}>
                    다음 질문으로
                  </Button>
                </div>
              </div>
            )}
            {notice && (
              <p className="px-1 text-[14px] leading-5 text-ink" role="status">
                {notice}
              </p>
            )}
            {micOn && stt.error && <MediaProblem device="mic" status={micStatusFromError(stt.error)} message={stt.error} onRetry={() => void stt.start(elapsed())} />}
            {stt.notice && <p className="px-1 text-[13px] text-secondary">{stt.notice}</p>}
            {stage === "answering" && <p className="text-center text-[14px] text-secondary">천천히, 핵심부터 답변해 보세요.</p>}
            <QaLog log={log} judges={rec.judges} />
          </div>
        )}
      </Screen>

      <BottomBar line={false}>
        {showMicRow && (
          <div className="flex h-14 items-center gap-3 rounded-full bg-surface p-1.5 pr-5">
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={micOn}
              aria-label={micOn ? "마이크 끄기" : "마이크 켜기"}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${micOn ? "bg-card text-ink" : "bg-ink text-inverse"}`}
            >
              {micOn ? <Mic size={22} /> : <MicOff size={22} />}
            </button>
            <Waveform bars={26} level={listening ? stt.level : 0} active={listening} className="h-7 min-w-0 flex-1 justify-center text-secondary" />
            <span className="shrink-0 text-[13px] font-medium text-secondary">{!micOn ? "마이크 꺼짐" : stage === "asking" ? "질문 듣는 중" : listening ? "듣는 중" : "대기 중"}</span>
          </div>
        )}
        {live ? (
          <Button onClick={() => void submit()} arrow disabled={stage !== "answering"}>
            {stage === "judging" ? "답변 확인 중…" : "답변 완료"}
          </Button>
        ) : stage === "prep-error" ? (
          <Button onClick={() => void generate()} disabled={!!error && !rec.judges.length}>
            다시 시도
          </Button>
        ) : (
          <Button onClick={startQa} arrow disabled={stage !== "ready"}>
            {stage === "ready" ? (log.length ? "질의응답 이어 가기" : "질의응답 시작") : "질문을 준비하고 있어요…"}
          </Button>
        )}
      </BottomBar>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "back" ? "질의응답을 멈추고 나갈까요?" : "시뮬레이션을 종료할까요?"}
        body="지금까지 진행한 내용은 연습 기록에 ‘진행 중’으로 남아요. 연습 기록에서 이어서 할 수 있어요."
        confirmLabel={confirm === "back" ? "나가기" : "종료하기"}
        onClose={() => void closeConfirm()}
        onConfirm={() => void leave()}
      />
      <PhaseEndDialog
        open={endReason !== null}
        title={endReason === "time" ? "질의응답 시간이 끝났어요" : "준비한 질문이 모두 끝났어요"}
        body="답변을 정리해 종합 결과를 보여 드릴게요."
        nextLabel="결과 보기"
        href={`/result?s=${id}`}
      />
    </>
  );
}

function answerEntry(c: Current, answer: TranscriptSentence[], askedAt: number): StoredQA {
  return {
    judge: c.judge,
    question: c.q.question,
    answer: answer.map((x) => x.text).join(" ").trim(),
    askedAt: Math.round(askedAt * 10) / 10,
    questionId: c.q.id,
    followup: c.q.kind === "followup",
    evidence: c.q.evidence,
    answerSentenceIds: answer.map((x) => x.id),
  };
}

function Prep({ rec, stage, prep, error, resumed, note }: { rec: SessionRecord; stage: Stage; prep: { stage: string; planned: number; got: Record<string, number>; failed: string[]; count: number }; error: string | null; resumed: boolean; note: string | null }) {
  const ready = stage === "ready";
  const pct = ready ? 100 : Math.min(95, (STAGE_PCT[prep.stage] ?? 8) + (prep.stage === "generate" && prep.planned ? (prep.count / prep.planned) * 55 : 0));
  return (
    <div className="mt-6 flex flex-col gap-5">
      <div role={stage === "prep-error" ? "alert" : "status"} aria-live="polite" className="flex flex-col gap-1.5">
        <p className="text-[22px] font-bold leading-8 tracking-[-0.4px]">
          {stage === "prep-error" ? "질문을 준비하지 못했어요" : ready ? (resumed ? "이어서 질문을 받을 수 있어요" : "질문이 준비됐어요") : "질문을 준비하고 있어요"}
        </p>
        <p className={`text-[15px] leading-[22px] ${stage === "prep-error" ? "text-error" : "text-secondary"}`}>
          {stage === "prep-error"
            ? error
            : ready
              ? `심사위원 ${rec.judges.length}명이 질문을 준비했어요. 시작하면 첫 질문을 소리 내어 읽어 드려요.`
              : `${STAGE_TEXT[prep.stage] ?? STAGE_TEXT.context} 1분 정도 걸려요.`}
        </p>
        {ready && note && (
          <p className="text-[13px] leading-[18px] text-secondary" role="note">
            {note}
          </p>
        )}
      </div>
      {stage !== "prep-error" && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-label="질문 준비 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="flex flex-col gap-2" aria-label="심사위원">
        {rec.judges.map((j) => {
          const n = prep.got[j.id] ?? 0;
          const failed = prep.failed.includes(j.id);
          return (
            <li key={j.id} className="flex items-center gap-3 rounded-[20px] bg-surface p-3">
              <SessionJudgeAvatar judge={j} size={48} />
              <p className="min-w-0 flex-1 text-[16px] leading-6">
                <span className="font-bold">{j.name}</span>
                <span className="text-secondary"> · {TEMPERAMENT_LABEL[j.temperament]}</span>
              </p>
              <span className={`shrink-0 text-[13px] font-medium ${failed ? "text-error" : "text-secondary"}`}>
                {ready ? "준비 완료" : failed ? "질문을 만들지 못했어요" : n ? `질문 ${n}개` : stage === "prep-error" ? "" : "준비 중"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 질문과 답변 기록 (collapsible). */
function QaLog({ log, judges }: { log: StoredQA[]; judges: StoredJudge[] }) {
  if (!log.length) return null;
  return (
    <details className="group mt-2 rounded-[20px] bg-surface">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-[15px] font-semibold">
        질문과 답변 기록 {log.length}개
        <span className="text-[13px] font-medium text-secondary group-open:hidden">펼치기</span>
        <span className="hidden text-[13px] font-medium text-secondary group-open:inline">접기</span>
      </summary>
      <ol className="flex flex-col gap-4 px-5 pb-5">
        {log.map((x, i) => {
          const j = judges.find((jj) => jj.id === x.judge.id);
          return (
            <li key={`${x.questionId}-${i}`} className="flex flex-col gap-1 border-t border-line pt-3 text-[14px] leading-[21px]">
              <p className="text-[12px] text-secondary">
                {i + 1}. {j?.name ?? x.judge.name} · {TEMPERAMENT_LABEL[x.judge.temperament]}
                {x.followup ? " · 꼬리질문" : ""}
              </p>
              <p className="font-semibold">{x.question}</p>
              <p className={x.answer ? "" : "text-secondary"}>{x.answer || "답변 없음"}</p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
