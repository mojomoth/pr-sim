"use client";
// /result?s=<id>[&tab=feedback] — 05 종합 결과 and 06 상세 피드백 of one session.
// No report yet → POST /api/report (NDJSON progress as a checklist), then persist it. A half report is never shown.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, TextLink } from "@/components/Button";
import { HeaderPill, StepHeader } from "@/components/Header";
import { Alert, Check } from "@/components/Icons";
import { Screen } from "@/components/Layout";
import { ApiError, streamReport, streamWiki, waitText } from "@/features/session/api";
import { getSession, updateSession } from "@/features/session/db";
import type { DocInput, ReportInput, SessionRecord, StoredDoc } from "@/features/session/types";
import { DOC_LABEL, type StepInfo } from "@/server/report/types";
import { Feedback } from "./Feedback";
import { Summary } from "./Summary";

type Load = { state: "loading" } | { state: "missing" } | { state: "failed"; message: string } | { state: "ready"; session: SessionRecord };
type Gen = { steps: StepInfo[]; startedAt: number; error?: { message: string; retryable: boolean } };

function reportInput(s: SessionRecord): ReportInput {
  const docs: DocInput[] = (["presentation", "proposal"] as const).flatMap((role) => {
    const d = s.docs[role];
    return d ? [{ role, docId: d.docId, filename: d.filename, pageTexts: d.pageTexts, wiki: d.wiki, keyNumbers: d.keyNumbers }] : [];
  });
  return {
    id: s.id,
    situation: s.setup.situation,
    presentationMinutes: s.setup.presentationMinutes,
    qaMinutes: s.setup.qaMinutes,
    judges: s.judges.map((j) => ({ id: j.id, name: j.name, temperament: j.temperament })),
    transcript: s.transcript,
    qa: s.qa.filter((x) => x.question.trim()).map((x) => ({ judge: x.judge, question: x.question, answer: x.answer, askedAt: x.askedAt })),
    docs,
    lint: s.questions?.lint,
  };
}

export function ResultScreen() {
  const params = useSearchParams();
  const id = params.get("s") ?? "";
  const tab = params.get("tab");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [gen, setGen] = useState<Gen | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    if (!id) {
      setLoad({ state: "missing" });
      return;
    }
    getSession(id)
      .then((s) => alive && setLoad(s ? { state: "ready", session: s } : { state: "missing" }))
      .catch((e) => alive && setLoad({ state: "failed", message: e instanceof Error && e.message ? e.message : "기록을 불러오지 못했어요." }));
    return () => {
      alive = false;
    };
  }, [id]);

  const session = load.state === "ready" ? load.session : null;
  const canReport = !!session && !session.report && (!!session.docs.presentation || !!session.docs.proposal) && (session.transcript.length > 0 || session.qa.length > 0);

  const generate = useCallback(async (s: SessionRecord) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const missing = (["presentation", "proposal"] as const).flatMap((r) => (s.docs[r] && !s.docs[r].wiki ? [s.docs[r]] : []));
    const wikiStep = (d: StoredDoc, status: StepInfo["status"], detail?: string): StepInfo => ({ id: `wiki:${d.role}`, group: "prep", label: `${DOC_LABEL[d.role]} 정리`, status, detail });
    const setStep = (step: StepInfo) =>
      setGen((g) => g && { ...g, steps: g.steps.some((x) => x.id === step.id) ? g.steps.map((x) => (x.id === step.id ? step : x)) : [...g.steps, step] });
    setGen({ steps: missing.map((d) => wikiStep(d, "running")), startedAt: Date.now() });
    try {
      // The report reads long documents through their wiki. A session whose wiki never finished (setup was left
      // early or the build failed) gets it built here first, and the result is kept in the session.
      if (missing.length) {
        await Promise.all(
          missing.map(async (d) => {
            const w = await streamWiki(
              { role: d.role, docId: d.docId, filename: d.filename, pageTexts: d.pageTexts },
              {
                signal: ac.signal,
                onEvent: (e) => e.type === "progress" && e.chunksTotal + e.roundsTotal > 0 && setStep(wikiStep(d, "running", `${e.chunksDone + e.roundsDone}/${e.chunksTotal + e.roundsTotal}`)),
              },
            );
            await updateSession(s.id, (cur) => {
              const c = cur.docs[d.role];
              if (!c || c.docId !== d.docId) return cur;
              return { ...cur, docs: { ...cur.docs, [d.role]: { ...c, wikiState: "ready", wikiError: undefined, wiki: w.wiki, keyNumbers: w.keyNumbers, wikiBuiltAt: new Date().toISOString() } } };
            });
            setStep(wikiStep(d, "done"));
          }),
        );
      }
      const latest = missing.length ? ((await getSession(s.id)) ?? s) : s;
      const done = await streamReport(
        { session: reportInput(latest) },
        {
          signal: ac.signal,
          onEvent: (e) => {
            if (e.type === "steps") setGen((g) => g && { ...g, steps: [...g.steps.filter((x) => x.id.startsWith("wiki:")), ...e.steps] });
            else if (e.type === "step") setStep(e.step);
          },
        },
      );
      const now = new Date().toISOString();
      const saved = await updateSession(s.id, (cur) => ({ ...cur, report: done.report, status: "done", resume: undefined, finishedAt: cur.finishedAt ?? now }));
      if (ac.signal.aborted) return;
      setLoad({ state: "ready", session: saved });
      setGen(null);
    } catch (e) {
      if (ac.signal.aborted) return;
      const message =
        e instanceof ApiError
          ? e.code === "rate_limited" && e.retryAfterSec
            ? `요청이 많아요. ${waitText(e.retryAfterSec)} 뒤 다시 시도해 주세요.`
            : e.message
          : e instanceof Error && e.message
            ? e.message
            : "결과를 만들지 못했어요. 다시 시도해 주세요.";
      setGen((g) => ({
        steps: (g?.steps ?? []).map((x) => (x.status === "running" ? { ...x, status: "error" as const } : x)),
        startedAt: g?.startedAt ?? Date.now(),
        error: { message, retryable: e instanceof ApiError ? e.retryable : true },
      }));
    }
  }, []);

  useEffect(() => {
    if (!canReport || !session) return;
    void generate(session);
    return () => abortRef.current?.abort();
    // Start once per loaded session without a report; `generate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReport, session?.id]);

  if (load.state === "loading") return <Screen><StepHeader title="결과" backHref="/history" /><p className="mt-10 text-center text-[15px] text-secondary">불러오는 중…</p></Screen>;
  if (load.state === "missing" || load.state === "failed")
    return (
      <Notice title={load.state === "missing" ? "기록을 찾을 수 없어요" : "기록을 불러오지 못했어요"} body={load.state === "missing" ? "삭제됐거나 다른 기기에서 진행한 연습이에요. 이 기기에 저장된 기록에서 다시 골라 주세요." : load.message}>
        <Button href="/history">기록 보러 가기</Button>
      </Notice>
    );

  const s = load.session;
  if (!s.report) {
    if (!canReport)
      return (
        <Notice title="아직 결과를 만들 수 없어요" body="발표나 질의응답 기록이 있어야 평가할 수 있어요. 연습을 마친 뒤에 다시 확인해 주세요.">
          <Button href="/history">기록 보러 가기</Button>
        </Notice>
      );
    return <Progress gen={gen} onRetry={() => void generate(s)} />;
  }
  return tab === "feedback" ? <Feedback session={s} report={s.report} /> : <Summary session={s} report={s.report} />;
}

function Notice({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <Screen>
      <StepHeader title="결과" backHref="/history" />
      <div className="mt-16 flex flex-col items-center text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-surface" aria-hidden="true">
          <Alert size={26} />
        </span>
        <h2 className="mt-5 text-[24px] font-bold leading-8 tracking-[-0.6px]">{title}</h2>
        <p className="mt-2 max-w-[32ch] text-[15px] leading-[23px] text-secondary">{body}</p>
        <div className="mt-8 w-full">{children}</div>
      </div>
    </Screen>
  );
}

const GROUPS: { id: StepInfo["group"]; label: string }[] = [
  { id: "prep", label: "준비" },
  { id: "speech", label: "발표" },
  { id: "qa", label: "질의응답" },
  { id: "materials", label: "자료" },
  { id: "overall", label: "종합" },
];

function useElapsed(from: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return from ? Math.max(0, Math.round((now - from) / 1000)) : 0;
}

function Spinner() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true" className="animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" stroke="var(--color-line)" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Progress({ gen, onRetry }: { gen: Gen | null; onRetry: () => void }) {
  const error = gen?.error;
  const elapsed = useElapsed(gen?.startedAt, !!gen && !error);
  const steps = gen?.steps ?? [];
  const finished = steps.filter((x) => x.status === "done" || x.status === "skipped").length;
  return (
    <Screen className="break-keep">
      <StepHeader title="종합 결과" backHref="/history" right={<HeaderPill href="/history">기록</HeaderPill>} />
      <div className="mt-6" aria-live="polite">
        <h2 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">{error ? "결과를 만들지 못했어요." : "결과를 정리하고 있어요."}</h2>
        <p className="mt-2 text-[15px] leading-[23px] text-secondary tabular">
          {error ? (
            "완성되지 않은 결과는 저장하지 않아요."
          ) : (
            <>
              발표와 답변, 자료를 함께 평가하고 있어요.
              <br />
              2~5분쯤 걸리니 이 화면을 연 채로 기다려 주세요. ({elapsed}초 지남)
            </>
          )}
        </p>
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-[20px] bg-surface p-5">
          <p className="text-[15px] font-semibold leading-[22px] text-error">{error.message}</p>
          <div className="mt-4 flex flex-col gap-2">
            <Button onClick={onRetry} variant={error.retryable ? "primary" : "secondary"}>
              {error.retryable ? "다시 시도" : "그래도 다시 시도"}
            </Button>
            <div className="flex justify-center">
              <TextLink href="/history">기록으로 돌아가기</TextLink>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3" aria-label={`평가 단계 ${steps.length}개 중 ${finished}개 완료`}>
        {steps.length === 0 && !error && (
          <p className="flex items-center gap-2 text-[15px] text-secondary">
            <Spinner /> 시작하는 중…
          </p>
        )}
        {GROUPS.map((g) => {
          const list = steps.filter((x) => x.group === g.id);
          if (!list.length) return null;
          return (
            <section key={g.id} className="rounded-[20px] bg-surface p-4">
              <h3 className="text-[15px] font-semibold text-secondary">{g.label}</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {list.map((x) => (
                  <li key={x.id} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2" data-status={x.status}>
                    <span className="mt-0.5">
                      {x.status === "running" ? (
                        <Spinner />
                      ) : x.status === "done" || x.status === "skipped" ? (
                        <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ink text-inverse">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      ) : x.status === "error" ? (
                        <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[15px] font-bold text-error">!</span>
                      ) : (
                        <span className="block h-[18px] w-[18px] rounded-full border-2 border-line" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[15px] leading-[22px] ${x.status === "pending" ? "text-secondary" : ""}`}>{x.label}</span>
                      {x.detail && <span className={`block text-[13px] leading-5 ${x.status === "error" ? "text-error" : "text-secondary"}`}>{x.detail}</span>}
                    </span>
                    <span className="sr-only">{STATUS_KO[x.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Screen>
  );
}

const STATUS_KO: Record<StepInfo["status"], string> = { pending: "대기", running: "진행 중", done: "완료", error: "실패", skipped: "건너뜀" };
