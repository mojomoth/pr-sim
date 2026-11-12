"use client";
// 06 · 상세 피드백 — 질문별 피드백 / 발표 분석. Every citation opens its source (cite.tsx).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomBar, Button, TextLink } from "@/components/Button";
import { HeaderPill, StepHeader } from "@/components/Header";
import { ArrowRight, Check, ChevronLeft } from "@/components/Icons";
import { JudgeAvatar } from "@/components/JudgeCard";
import { Card, Screen } from "@/components/Layout";
import { useBlobUrl } from "@/features/session/db";
import type { Report, SessionRecord, StoredJudge } from "@/features/session/types";
import { mmss } from "@/features/session/useCountdown";
import { DOC_LABEL, type Contradiction, type DocEvaluation, type QAEvaluation } from "@/server/report/types";
import { TEMPERAMENT_LABEL, type Temperament } from "@/server/types";
import { cloneAsDraft } from "../setup/draft";
import { AnswerRef, CiteProvider, CiteText, DocRefChips, PageRef, SentenceRef } from "./cite";
import { LiteNotice, ProviderNote } from "./notes";

type Tab = "qa" | "analysis";

const VERDICT_HEAD: Record<QAEvaluation["verdict"], string> = {
  strong: "좋은 답변이었어요.",
  adequate: "조금 더 구체적으로\n답해 보세요.",
  weak: "답변에 근거를\n더해 보세요.",
  evasive: "질문에 정면으로\n답해 보세요.",
};
const VERDICT_KO: Record<QAEvaluation["verdict"], string> = { strong: "충실", adequate: "보통", weak: "미흡", evasive: "회피" };
const SEVERITY_KO = { high: "높음", medium: "중간", low: "낮음" } as const;
const RATE_KO = { slow: "느림", ok: "적정", fast: "빠름" } as const;
const TIME_KO = { short: "짧음", ok: "적정", over: "초과" } as const;
const COVER_KO = { covered: "다룸", partial: "일부", missing: "빠짐" } as const;
const CATEGORY_KO = { structure: "구성", logic: "논리", evidence: "근거", consistency: "일관성", clarity: "명료성" } as const;


export function Feedback({ session, report }: { session: SessionRecord; report: Report }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(report.qa.length ? "qa" : "analysis");
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [againError, setAgainError] = useState<string | null>(null);
  const n = report.qa.length;
  const q = report.qa[Math.min(i, n - 1)];
  const headline = tab === "qa" ? (q ? VERDICT_HEAD[q.verdict] : "질의응답 기록이 없어요.") : report.overall.headline;

  const tabs: { id: Tab; label: string }[] = [
    { id: "qa", label: "질문별 피드백" },
    { id: "analysis", label: "발표 분석" },
  ];

  async function again() {
    setBusy(true);
    setAgainError(null);
    try {
      // Same setup, documents and judges in a new session. A document whose wiki never finished goes
      // through /setup, which rebuilds it; otherwise straight to the presentation.
      const next = await cloneAsDraft(session);
      const ready = Object.values(next.docs).every((d) => d.wikiState === "ready");
      router.push(ready && next.judges.length > 0 ? `/present?s=${encodeURIComponent(next.id)}` : "/setup");
    } catch (e) {
      setAgainError(e instanceof Error && e.message ? e.message : "새 연습을 만들지 못했어요. 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <CiteProvider session={session}>
      <Screen bottomPad={136} className="break-keep [overflow-wrap:anywhere]">
        <StepHeader
          title="상세 피드백"
          backHref={`/result?s=${encodeURIComponent(session.id)}`}
          right={tab === "qa" && n > 0 ? <HeaderPill label={`질문 ${i + 1} / ${n}`}>{`${i + 1} / ${n}`}</HeaderPill> : undefined}
        />

        <h2 className="mt-5 whitespace-pre-line text-[28px] font-bold leading-9 tracking-[-0.8px]">{headline}</h2>

        <div role="tablist" aria-label="피드백 종류" className="mt-6 grid grid-cols-2 rounded-full bg-surface p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const next = tab === "qa" ? "analysis" : "qa";
                  setTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
              className={`h-12 rounded-full text-[16px] font-semibold transition-colors duration-200 ${tab === t.id ? "bg-ink text-inverse" : "text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <LiteNotice report={report} />
        </div>

        {tab === "qa" ? (
          <section id="panel-qa" role="tabpanel" aria-labelledby="tab-qa" className="mt-1 flex flex-col">
            {q ? (
              <QAPanel
                key={i}
                session={session}
                q={q}
                index={Math.min(i, n - 1)}
                total={n}
                onIndex={(k) => {
                  setI(k);
                  // The next/previous buttons sit at the bottom: start the new question from the top.
                  document.getElementById("app-scroll")?.scrollTo({ top: 0 });
                }}
              />
            ) : (
              <Card>
                <p className="text-[16px] leading-6 text-secondary">이번 연습에서는 질의응답을 진행하지 않았어요. 발표 분석 탭에서 발표 피드백을 확인해 보세요.</p>
              </Card>
            )}
          </section>
        ) : (
          <section id="panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" className="mt-1 flex flex-col gap-8">
            <SpeechSection report={report} />
            <MaterialsSection report={report} />
            <SummarySection report={report} />
          </section>
        )}
        <div className="mt-8">
          <ProviderNote report={report} />
        </div>
      </Screen>

      <BottomBar>
        {againError && (
          <p role="alert" className="text-center text-[14px] text-error">
            {againError}
          </p>
        )}
        <Button onClick={again} disabled={busy} arrow={!busy}>
          {busy ? "준비하는 중…" : "같은 조건으로 다시 연습"}
        </Button>
        <div className="flex justify-center">
          <TextLink href="/history">기록으로 돌아가기</TextLink>
        </div>
      </BottomBar>
    </CiteProvider>
  );
}

// ───────────────────────── 질문별 피드백 ─────────────────────────

function JudgeFace({ judge, name, temperament }: { judge?: StoredJudge; name: string; temperament: Temperament }) {
  const url = useBlobUrl(judge?.thumbKey);
  return <JudgeAvatar judge={{ name, persona: TEMPERAMENT_LABEL[temperament], imageUrl: url }} size={76} />;
}

function QAPanel({ session, q, index, total, onIndex }: { session: SessionRecord; q: QAEvaluation; index: number; total: number; onIndex: (i: number) => void }) {
  const judge = session.judges.find((j) => j.id === q.judge.id);
  const stored = session.qa[q.index]?.question === q.question ? session.qa[q.index] : session.qa.find((x) => x.question === q.question);
  return (
    <div className="ui-enter flex flex-col">
      <article className="mt-4 flex gap-4 rounded-[28px] bg-surface p-5">
        <JudgeFace judge={judge} name={q.judge.name} temperament={q.judge.temperament} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex h-7 min-w-0 items-center truncate rounded-full bg-canvas px-3 text-[13px] font-semibold">
              {q.judge.name} · {TEMPERAMENT_LABEL[q.judge.temperament]}
            </span>
            <span className="shrink-0 text-[13px] text-secondary tabular">질문 {String(index + 1).padStart(2, "0")}</span>
          </div>
          <p className="mt-2.5 text-[17px] font-semibold leading-[25px] tracking-[-0.3px]">{q.question}</p>
        </div>
      </article>

      <div className="mt-6 px-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[14px] text-secondary">내 답변</p>
          {stored && <AnswerRef ids={stored.answerSentenceIds} />}
        </div>
        <p className="mt-1.5 whitespace-pre-line text-[17px] font-medium leading-[26px]">{q.answer || "답변하지 않았어요."}</p>
        {q.answerFillers > 0 && <p className="mt-1 text-[13px] text-secondary">답변 속 군말 {q.answerFillers}회</p>}
      </div>
      <hr className="mx-1 my-5 border-line" />
      <div className="px-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[14px] text-secondary">심사위원 피드백</p>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-8 items-center rounded-full border border-line px-3 text-[13px] font-semibold">{VERDICT_KO[q.verdict]}</span>
            <span className="inline-flex h-8 items-center rounded-full bg-surface px-3 text-[15px] font-bold tabular" aria-label={`답변 타당성 ${q.score}점`}>
              {q.score}점
            </span>
          </span>
        </div>
        <p className="mt-1.5 whitespace-pre-line text-[17px] font-medium leading-[26px]"><CiteText text={q.feedback} /></p>
        <details className="mt-3 rounded-[20px] border border-line px-4 py-3">
          <summary className="cursor-pointer text-[14px] font-semibold">항목별 점수와 평가 근거</summary>
          <div className="mt-3 flex flex-col gap-2.5">
            <Meter label="관련성" value={q.scores.relevance} />
            <Meter label="정확성" value={q.scores.accuracy} />
            <Meter label="근거 활용" value={q.scores.evidence} />
            <Meter label="완결성" value={q.scores.completeness} />
            <Meter label="태도" value={q.scores.composure} />
          </div>
          <p className="mt-3 text-[14px] leading-[22px] text-secondary"><CiteText text={q.rationale} /></p>
        </details>
      </div>

      {q.contradictions.length > 0 && (
        <div className="mt-4">
          <Contradictions title="자료와 다른 점" items={q.contradictions} />
        </div>
      )}

      {q.missing.length > 0 && (
        <div className="mt-5 px-1">
          <p className="text-[14px] text-secondary">좋은 답변에 필요했던 것</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {q.missing.map((m, k) => (
              <li key={k} className="flex gap-2 text-[15px] leading-[22px]">
                <span aria-hidden="true">·</span>
                <span>
                  <CiteText text={m} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded-[28px] bg-surface p-6">
        <p className="text-[14px] text-secondary">이렇게 답해 보세요</p>
        <p className="mt-2 whitespace-pre-line text-[18px] font-semibold leading-[28px] tracking-[-0.3px]"><CiteText text={q.improvedAnswer} /></p>
        {q.citations.length > 0 && (
          <div className="mt-3">
            <DocRefChips refs={q.citations} max={3} />
          </div>
        )}
      </div>

      <nav className="mt-4 flex items-center justify-between" aria-label="질문 이동">
        <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0} className="inline-flex h-11 items-center gap-1 rounded-full px-3 text-[15px] font-semibold disabled:invisible">
          <ChevronLeft size={18} /> 이전 질문
        </button>
        <button type="button" onClick={() => onIndex(index + 1)} disabled={index >= total - 1} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[16px] font-semibold disabled:text-secondary">
          {index >= total - 1 ? "마지막 질문이에요" : "다음 질문 보기"} {index < total - 1 && <ArrowRight size={18} />}
        </button>
      </nav>
    </div>
  );
}

// ───────────────────────── 발표 분석 ─────────────────────────

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-end justify-between gap-3">
      <h3 className="text-[22px] font-bold leading-8 tracking-[-0.5px]">{children}</h3>
      {aside}
    </div>
  );
}

function ScorePill({ score }: { score: number | null }) {
  return <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-surface px-3.5 text-[16px] font-bold tabular">{score ?? "-"}점</span>;
}

/** Monochrome meter (0–100). */
function Meter({ label, value, note }: { label: string; value: number; note?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)_32px] items-center gap-3">
      <span className="text-[14px] font-medium leading-5 text-secondary">{label}</span>
      <span className="relative h-2 overflow-hidden rounded-full bg-line" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </span>
      <span className="text-right text-[15px] font-semibold tabular">{value}</span>
      {note && <span className="col-span-3 -mt-1 text-[13px] leading-5 text-secondary">{note}</span>}
    </div>
  );
}

function Stat({ label, value, unit, note, flag }: { label: string; value: string | number; unit?: string; note?: string; flag?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[20px] bg-surface p-4">
      <span className="flex items-center justify-between gap-1 text-[13px] font-medium leading-5 text-secondary">
        {label}
        {flag && <span className={`rounded-full px-2 text-[12px] font-semibold ${flag === "적정" ? "bg-canvas text-ink" : "bg-ink text-inverse"}`}>{flag}</span>}
      </span>
      <span className="mt-1 text-[26px] font-bold leading-9 tracking-[-0.8px] tabular">
        {value}
        {unit && <span className="ml-1 text-[13px] font-semibold tracking-normal text-secondary">{unit}</span>}
      </span>
      {note && <span className="text-[12px] leading-[18px] text-secondary">{note}</span>}
    </div>
  );
}

function Contradictions({ title, items }: { title: string; items: Contradiction[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-ink p-4">
      <p className="text-[15px] font-bold">
        {title} {items.length}건
      </p>
      {items.map((c, k) => (
        <div key={k} className="flex flex-col gap-1.5">
          <p className="text-[15px] leading-[22px] [overflow-wrap:anywhere]">
            <span className="font-semibold">말한 내용</span> <CiteText text={c.claim} />
            {c.matchesDoc && <span className="text-[12px] text-secondary"> ({DOC_LABEL[c.matchesDoc]}의 수치와 같아요. 자료끼리 다른 경우라 감점하지 않았어요.)</span>}
          </p>
          <p className="text-[15px] leading-[22px] text-secondary [overflow-wrap:anywhere]">
            <span className="font-semibold text-ink">자료</span> <CiteText text={c.docSays} />
          </p>
          <DocRefChips refs={c.refs} />
        </div>
      ))}
    </div>
  );
}

function SpeechSection({ report }: { report: Report }) {
  const m = report.speech.metrics;
  const a = report.speech.analysis;
  const maxBar = Math.max(1, ...m.rateTimeline.map((x) => x.syllables), 340);
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle aside={<ScorePill score={report.overall.sub.delivery} />}>내용 및 전달력 분석</SectionTitle>

      {a && (
        <Card>
          <p className="text-[16px] leading-[25px]">
            <CiteText text={a.summary} />
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Meter label="구조" value={a.scores.structure} note={<CiteText text={a.structureNote} />} />
            <Meter label="명료성" value={a.scores.clarity} note={<CiteText text={a.clarityNote} />} />
            <Meter label="설득력" value={a.scores.persuasiveness} note={<CiteText text={a.persuasivenessNote} />} />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="말 속도" value={m.syllablesPerMinute} unit="음절/분" note="적정 240–340" flag={RATE_KO[m.rateStatus]} />
        <Stat label="시간 사용" value={mmss(m.spokenSeconds)} unit={`/ ${mmss(m.targetSeconds)}`} note={`목표 시간의 ${Math.round(m.timeUsage * 100)}%`} flag={TIME_KO[m.timeStatus]} />
        <Stat label="군말" value={m.fillers.total} unit="회" note={`분당 ${m.fillers.perMinute}회`} flag={m.fillers.perMinute > 2 ? "많음" : "적정"} />
        <Stat label="긴 침묵" value={m.pauses.count} unit="회" note={m.pauses.count ? `가장 길게 ${m.pauses.longest}초` : `${m.pauses.threshold}초 넘는 침묵 없음`} />
      </div>

      <Card>
        <div className="flex items-baseline justify-between">
          <p className="text-[16px] font-semibold">전달 점수</p>
          <span className="text-[28px] font-bold leading-9 tracking-[-0.8px] tabular">{m.deliveryScore}</span>
        </div>
        {m.deliveryPenalties.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {m.deliveryPenalties.map((p, k) => (
              <li key={k} className="flex justify-between gap-3 text-[15px] leading-[22px]">
                <span>{p.reason}</span>
                <span className="font-semibold tabular">−{p.points}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[15px] text-secondary">감점 요인이 없어요.</p>
        )}
        {m.rateTimeline.length > 1 && (
          <figure className="mt-5">
            <figcaption className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold">분 단위 말 속도</span>
              <span className="text-[12px] text-secondary">점선은 적정 상한 340음절</span>
            </figcaption>
            <div className="relative mt-3 flex h-24 items-end gap-1.5" role="img" aria-label={`분 단위 음절 수: ${m.rateTimeline.map((x) => `${x.minute + 1}분째 ${x.syllables}`).join(", ")}`}>
              <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-secondary" style={{ bottom: `${(340 / maxBar) * 100}%` }} aria-hidden="true" />
              {m.rateTimeline.map((x) => (
                <span key={x.minute} className={`flex-1 rounded-t-[6px] ${x.syllables > 340 || x.syllables < 240 ? "bg-secondary/50" : "bg-ink"}`} style={{ height: `${(x.syllables / maxBar) * 100}%` }} />
              ))}
            </div>
            <div className="mt-1 flex gap-1.5">
              {m.rateTimeline.map((x) => (
                <span key={x.minute} className="flex-1 text-center text-[11px] text-secondary tabular">
                  {x.minute}분
                </span>
              ))}
            </div>
          </figure>
        )}
      </Card>

      {(m.fillers.examples.length > 0 || m.pauses.items.length > 0 || m.maxSentence) && (
        <Card>
          {m.fillers.byWord.length > 0 && (
            <>
              <p className="text-[15px] font-semibold">자주 나온 군말</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.fillers.byWord.map((f) => (
                  <span key={`${f.kind}${f.word}`} className={`inline-flex h-7 items-center rounded-full px-2.5 text-[13px] font-semibold tabular ${f.kind === "hesitation" ? "bg-ink text-inverse" : "bg-canvas"}`}>
                    {f.word} ×{f.count}
                  </span>
                ))}
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {m.fillers.examples.slice(0, 4).map((e) => (
                  <li key={e.sentenceId}>
                    <SentenceRef id={e.sentenceId} withText />
                  </li>
                ))}
              </ul>
            </>
          )}
          {m.pauses.items.length > 0 && (
            <div className="mt-4">
              <p className="text-[15px] font-semibold">긴 침묵 ({m.pauses.threshold}초 이상)</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {m.pauses.items.map((p) => (
                  <li key={p.afterSentenceId} className="flex items-center gap-1">
                    <SentenceRef id={p.afterSentenceId} />
                    <span className="text-[13px] text-secondary tabular">뒤 {p.seconds}초</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {m.maxSentence && m.longSentences > 0 && (
            <div className="mt-4">
              <p className="text-[15px] font-semibold">가장 긴 문장 ({m.maxSentenceSyllables}음절)</p>
              <p className="mt-1">
                <SentenceRef id={m.maxSentence.sentenceId} withText />
              </p>
            </div>
          )}
        </Card>
      )}

      {a && a.numberIssues.length > 0 && <Contradictions title="발표에서 말한 수치가 자료와 달라요" items={a.numberIssues} />}

      {a && a.coverage.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <p className="text-[16px] font-semibold">슬라이드별 설명</p>
            <span className="text-[14px] font-semibold tabular">{Math.round(a.coverageRate * 100)}% 다룸</span>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {a.coverage.map((c) => (
              <li key={c.page} className="flex flex-col gap-1.5 py-3">
                <div className="flex items-start gap-2">
                  <PageRef doc="presentation" page={c.page} label={`p.${c.page}`} />
                  <span className="min-w-0 flex-1 pt-1 text-[15px] font-semibold leading-[22px]">{c.title}</span>
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${c.status === "covered" ? "bg-ink text-inverse" : c.status === "partial" ? "border border-ink" : "border border-dashed border-secondary text-secondary"}`}
                  >
                    {COVER_KO[c.status]}
                  </span>
                </div>
                {c.status !== "covered" && c.note && (
                  <p className="text-[13px] leading-5 text-secondary">
                    <CiteText text={c.note} />
                  </p>
                )}
                {c.sentenceIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {c.sentenceIds.slice(0, 3).map((id) => (
                      <SentenceRef key={id} id={id} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function DocCard({ d }: { d: DocEvaluation }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle aside={<ScorePill score={d.score} />}>{DOC_LABEL[d.role]} 평가</SectionTitle>
      <Card>
        <p className="truncate text-[13px] text-secondary">
          {d.filename} · {d.pageCount}쪽
        </p>
        <p className="mt-2 text-[16px] leading-[25px]">
          <CiteText text={d.summary} doc={d.role} />
        </p>
        <div className="mt-4 flex flex-col gap-2.5">
          <Meter label="구성" value={d.scores.structure} />
          <Meter label="논리" value={d.scores.logic} />
          <Meter label="근거" value={d.scores.evidence} />
          <Meter label="일관성" value={d.scores.consistency} />
          <Meter label="명료성" value={d.scores.clarity} />
        </div>
        {d.strengths.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5">
            {d.strengths.map((s, k) => (
              <li key={k} className="flex gap-2 text-[15px] leading-[22px]">
                <Check size={18} className="mt-0.5 shrink-0" />
                <span>
                  <CiteText text={s} doc={d.role} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {d.issues.map((it, k) => (
        <article key={k} className="rounded-[20px] border border-line p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${it.severity === "high" ? "bg-ink text-inverse" : "border border-line"}`}>중요도 {SEVERITY_KO[it.severity]}</span>
            <span className="text-[12px] font-semibold text-secondary">{CATEGORY_KO[it.category]}</span>
          </div>
          <p className="mt-1.5 text-[16px] font-semibold leading-6">{it.title}</p>
          <p className="mt-1 text-[14px] leading-[22px] text-secondary [overflow-wrap:anywhere]"><CiteText text={it.detail} doc={d.role} /></p>
          <p className="mt-2 text-[14px] leading-[22px]">
            <span className="font-semibold">고치는 법</span> <CiteText text={it.fix} doc={d.role} />
          </p>
          {it.refs.length > 0 && (
            <div className="mt-2">
              <DocRefChips refs={it.refs} max={3} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function MaterialsSection({ report }: { report: Report }) {
  const mat = report.materials;
  const order = ["presentation", "proposal"] as const;
  const docs = order.flatMap((r) => mat.docs.filter((d) => d.role === r));
  const mismatches = mat.consistency.filter((r) => r.status === "mismatch");
  return (
    <>
      {docs.map((d) => (
        <DocCard key={d.role} d={d} />
      ))}
      {mismatches.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionTitle>두 자료의 수치 비교</SectionTitle>
          <ul className="flex flex-col gap-2.5">
            {mismatches.map((r, k) => (
              <li key={k} className="rounded-[20px] border border-line p-4">
                <p className="text-[15px] font-semibold leading-[22px]">{r.metric}</p>
                {(["presentation", "proposal"] as const).map((role) => {
                  const v = r[role];
                  return (
                    <div key={role} className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[14px] leading-[21px]">
                      <span className="text-secondary">{DOC_LABEL[role]}</span>
                      {v ? (
                        <>
                          <span className="font-semibold">{v.value}</span>
                          {v.pages.slice(0, 3).map((p) => (
                            <PageRef key={p} doc={role} page={p} label={`p.${p}`} />
                          ))}
                        </>
                      ) : (
                        <span className="text-secondary">없음</span>
                      )}
                    </div>
                  );
                })}
                {r.note && (
                  <p className="mt-2 text-[13px] leading-5 text-secondary">
                    <CiteText text={r.note} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function SummarySection({ report }: { report: Report }) {
  const a = report.speech.analysis;
  const strengths = a?.strengths.length ? a.strengths : report.overall.strengths;
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>정리</SectionTitle>
      {strengths.length > 0 && (
        <Card title="강점">
          <ul className="flex flex-col gap-2">
            {strengths.map((s, k) => (
              <li key={k} className="flex gap-2 text-[15px] leading-[22px]">
                <Check size={18} className="mt-0.5 shrink-0" />
                <span>
                  <CiteText text={s} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {a && a.improvements.length > 0 && (
        <Card title="부족한 점">
          <ul className="flex flex-col gap-2">
            {a.improvements.map((s, k) => (
              <li key={k} className="flex gap-2 text-[15px] leading-[22px]">
                <span aria-hidden="true">·</span>
                <span>
                  <CiteText text={s} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {report.overall.priorities.length > 0 && (
        <Card title="개선 제안">
          <ol className="flex flex-col gap-4">
            {report.overall.priorities.map((p, k) => (
              <li key={k} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2">
                <span className="text-[16px] font-bold leading-6 tabular">{k + 1}</span>
                <div>
                  <p className="text-[16px] font-semibold leading-6">{p.title}</p>
                  <p className="mt-0.5 text-[14px] leading-5 text-secondary">
                    <CiteText text={p.why} />
                  </p>
                  <p className="mt-1 text-[15px] leading-[22px]">
                    <CiteText text={p.how} />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
