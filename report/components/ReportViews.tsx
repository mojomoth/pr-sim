"use client";
import { TEMPERAMENT_LABEL } from "@/lib/types";
import { DOC_LABEL, SUBSCORE_LABEL, type QAEvaluation, type Report, type SubScores } from "../lib/types";
import { Arrow, Card, CheckIcon, fmtSec, H2, Label, Meter, Pill, RefChips, ScoreBadge, SEVERITY_KO } from "./parts";

export type DetailTab = "qa" | "speech" | "materials";

/** LLM text often joins page lists without spaces ("p.3·p.5·p.9·…"); add a zero-width break opportunity after each
 *  separator so such runs wrap at a separator instead of mid-token (the main container also sets overflow-wrap). */
export const soft = (s: string) => s.replace(/([·,/])(?=\S)/g, "$1\u200b");

/** Lite fallback models judged at least one section → scores can be inflated (see README 알려진 한계). */
export function liteModels(report: Report): string[] {
  const used = Object.keys(report.meta.usage.byModel ?? {});
  const lite = used.filter((k) => /lite/i.test(k)).map((k) => k.replace(/^\w+:/, ""));
  if (lite.length) return [...new Set(lite)];
  return /lite/i.test(report.meta.provider) ? [...new Set(report.meta.provider.match(/[\w.-]*lite[\w.-]*/gi) ?? [])] : [];
}

export function LiteNotice({ report }: { report: Report }) {
  const lite = liteModels(report);
  if (!lite.length) return null;
  return (
    <p className="rounded-[16px] border border-ink px-4 py-3 text-[14px] leading-[21px]" data-testid="lite-notice">
      <span className="font-semibold">경량 폴백 모델이 채점한 리포트예요.</span> 주력 모델(Claude·GPT)이 사용 한도에 걸려 {lite.join(" · ")}로 판정했어요. 같은 답변도 점수가
      10–25점 후하게 나오거나 누락을 놓칠 수 있으니 참고용으로만 보세요.
    </p>
  );
}

const shortSituation = (s: string) => {
  const m = /(?:친환경|[가-힣]+)\s*[^.。]{0,18}(사업|제안|피칭|발표)/.exec(s);
  return m ? m[0] : s.slice(0, 24);
};

// ───────────────────────── 종합 결과 ─────────────────────────

export function ResultView({ report, onDetail }: { report: Report; onDetail: (tab: DetailTab) => void }) {
  const o = report.overall;
  const subs = (Object.keys(SUBSCORE_LABEL) as (keyof SubScores)[]).filter((k) => o.sub[k] != null);
  return (
    <div className="flex flex-col gap-4">
      <div className="pb-4 pt-2 text-center">
        <h2 className="mx-auto max-w-[15ch] text-balance break-keep text-[32px] font-bold leading-10 tracking-[-1px] sm:text-[40px] sm:leading-[48px]" data-testid="headline">
          {o.headline}
        </h2>
        <p className="mt-2 text-[16px] leading-6 text-secondary">{shortSituation(report.meta.situation)}</p>
      </div>

      <Card className="relative">
        <Label>이번 발표의 종합 점수</Label>
        <span className="absolute right-6 top-6 h-3 w-3 rounded-full bg-ink" aria-hidden />
        <p className="mt-1 flex items-end gap-2">
          <span className="text-[80px] font-bold leading-[88px] tracking-[-4px] tabular" data-testid="total">
            {o.total}
          </span>
          <span className="mb-3 text-[24px] text-secondary tabular">/ 100</span>
        </p>
        {o.oneLiner && <p className="mt-1 text-[17px] leading-6 text-secondary">{o.oneLiner}</p>}
        {!!o.excluded?.length && (
          <p className="mt-3 rounded-[14px] bg-surface px-3 py-2 text-[14px] leading-5 text-secondary" data-testid="excluded">
            {o.excluded.map((x) => `${SUBSCORE_LABEL[x.key]}`).join("·")}은 총점에서 빠졌어요 — {o.excluded.map((x) => x.reason).join(", ")}. 나머지 항목 가중치로 계산했어요.
          </p>
        )}
      </Card>

      <LiteNotice report={report} />

      <div className={`grid gap-3 ${subs.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        {subs.map((k) => (
          <div key={k} className="flex flex-col items-center rounded-[20px] bg-surface px-2 py-4" data-testid={`sub-${k}`}>
            <span className="text-[14px] font-medium leading-5 text-secondary">{SUBSCORE_LABEL[k]}</span>
            <span className="text-[40px] font-bold leading-[48px] tracking-[-1.5px] tabular">{o.sub[k]}</span>
          </div>
        ))}
      </div>

      {o.strengths.length > 0 && (
        <Card tone="surface">
          <H2>잘한 점</H2>
          <ul className="mt-3 flex flex-col gap-3">
            {o.strengths.map((s, i) => (
              <li key={i} className="flex gap-3 text-[16px] leading-6">
                <CheckIcon />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {o.priorities.length > 0 && (
        <Card tone="surface">
          <H2>다음 연습에서는</H2>
          <ol className="mt-3 flex flex-col gap-4">
            {o.priorities.map((p, i) => (
              <li key={i} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
                <span className="text-[16px] font-bold leading-6 tabular">{i + 1}</span>
                <div>
                  <p className="text-[16px] font-semibold leading-6">{p.title}</p>
                  <p className="mt-0.5 text-[14px] leading-5 text-secondary">{p.why}</p>
                  <p className="mt-1 text-[15px] leading-[22px]">{p.how}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <p className="rounded-full bg-surface px-4 py-3 text-center text-[14px] font-medium text-secondary tabular">
        발표 {report.meta.presentationMinutes}분 · 질의응답 {report.meta.qaMinutes}분 · 질문 {report.meta.questions}개
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => onDetail("qa")} className="flex h-14 items-center justify-center gap-2 rounded-[20px] bg-ink text-[16px] font-semibold text-inverse sm:col-span-3">
          상세 피드백 보기 <Arrow />
        </button>
        <button type="button" onClick={() => onDetail("speech")} className="h-12 rounded-[20px] bg-surface text-[15px] font-semibold">
          발표 분석
        </button>
        <button type="button" onClick={() => onDetail("materials")} className="h-12 rounded-[20px] bg-surface text-[15px] font-semibold">
          자료 품질
        </button>
        <a href={`/api/report/reports/${report.meta.key}?download=1`} download className="flex h-12 items-center justify-center rounded-[20px] bg-surface text-[15px] font-semibold" data-testid="download">
          JSON 다운로드
        </a>
      </div>
      <MetaFoot report={report} />
    </div>
  );
}

export function MetaFoot({ report }: { report: Report }) {
  const m = report.meta;
  return (
    <div className="mt-2 text-[12px] leading-[18px] text-secondary">
      <p>
        판정 모델 {m.provider} · 생성 {(m.ms / 1000).toFixed(1)}초 · LLM 호출 {m.usage.calls}회 (입력 {m.usage.inputTokens.toLocaleString()} / 출력 {m.usage.outputTokens.toLocaleString()} 토큰) ·{" "}
        {new Date(m.createdAt).toLocaleString("ko-KR")}
      </p>
      <p>
        점수 = 발표력 25% · 논리성 25% · 대응력 30% · 자료 품질 20% (코드 집계). 전달 지표(말 속도·군말·침묵·시간)는 코드가 전사 타임스탬프로 계산하고, 내용 판단만 LLM이 루브릭으로 채점합니다.
      </p>
      {m.warnings.map((w, i) => (
        <p key={i}>※ {w}</p>
      ))}
    </div>
  );
}

// ───────────────────────── 상세 피드백 ─────────────────────────

export function DetailView({ report, tab, onTab, qaIndex, onQa }: { report: Report; tab: DetailTab; onTab: (t: DetailTab) => void; qaIndex: number; onQa: (i: number) => void }) {
  const tabs: { id: DetailTab; label: string }[] = [
    { id: "qa", label: "질문별 피드백" },
    { id: "speech", label: "발표 분석" },
    { id: "materials", label: "자료 품질" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="상세 피드백 구분" className="grid grid-cols-3 rounded-full bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={`h-12 rounded-full text-[15px] font-semibold sm:text-[16px] ${tab === t.id ? "bg-ink text-inverse" : "text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <LiteNotice report={report} />
      {tab === "qa" && <QAPanel report={report} index={qaIndex} onIndex={onQa} />}
      {tab === "speech" && <SpeechPanel report={report} />}
      {tab === "materials" && <MaterialsPanel report={report} />}
      <MetaFoot report={report} />
    </div>
  );
}

const VERDICT_HEAD: Record<QAEvaluation["verdict"], string> = {
  strong: "좋은 답변이었어요.",
  adequate: "조금 더 구체적으로 답해 보세요.",
  weak: "답변에 근거를 더해 보세요.",
  evasive: "질문에 정면으로 답해 보세요.",
};
const VERDICT_KO: Record<QAEvaluation["verdict"], string> = { strong: "충실", adequate: "보통", weak: "미흡", evasive: "회피" };

export function qaHeadline(q: QAEvaluation | undefined) {
  return q ? VERDICT_HEAD[q.verdict] : "질의응답이 없어요.";
}

function JudgeAvatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  return (
    <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full bg-line sm:h-[88px] sm:w-[88px]">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- judge face served by the judge PoC API
        <img src={imageUrl} alt={`${name} 심사위원`} className="h-full w-full object-cover" />
      ) : (
        <span role="img" aria-label={`${name} 심사위원`} className="flex h-full w-full items-center justify-center text-[28px] font-bold text-secondary">
          {name.slice(0, 1)}
        </span>
      )}
    </div>
  );
}

function QAPanel({ report, index, onIndex }: { report: Report; index: number; onIndex: (i: number) => void }) {
  const n = report.qa.length;
  if (!n) return <Card tone="surface">질의응답 기록이 없어요.</Card>;
  const i = Math.min(Math.max(0, index), n - 1);
  const q = report.qa[i];
  const docIds = report.meta.docIds;
  return (
    <div className="flex flex-col gap-5" data-testid="qa-panel">
      <h3 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">{VERDICT_HEAD[q.verdict]}</h3>
      <Card className="flex gap-4">
        <JudgeAvatar name={q.judge.name} imageUrl={q.judge.imageUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Pill tone="canvas">
              {q.judge.name.length > 2 ? q.judge.name.slice(1) : q.judge.name} · {TEMPERAMENT_LABEL[q.judge.temperament]}
            </Pill>
            <span className="text-[14px] font-medium text-secondary tabular">질문 {String(i + 1).padStart(2, "0")}</span>
          </div>
          <p className="mt-2 text-[17px] font-semibold leading-[26px]">{q.question}</p>
        </div>
      </Card>

      <div>
        <Label>내 답변</Label>
        <p className="mt-1 text-[17px] leading-[26px]">{q.answer || "(무응답)"}</p>
        {q.answerFillers > 0 && <p className="mt-1 text-[12px] text-secondary">답변 속 군말 {q.answerFillers}회</p>}
      </div>
      <hr className="border-line" />

      <div>
        <div className="flex items-center justify-between">
          <Label>심사위원 피드백</Label>
          <span className="flex items-center gap-2">
            <Pill tone="line">{VERDICT_KO[q.verdict]}</Pill>
            <ScoreBadge score={q.score} />
          </span>
        </div>
        <p className="mt-2 text-[17px] font-medium leading-[26px]">{q.feedback}</p>
      </div>

      <div className="flex flex-col gap-2.5 rounded-[20px] border border-line p-4">
        <Meter label="관련성" value={q.scores.relevance} />
        <Meter label="정확성" value={q.scores.accuracy} />
        <Meter label="근거 활용" value={q.scores.evidence} />
        <Meter label="완결성" value={q.scores.completeness} />
        <Meter label="태도" value={q.scores.composure} />
        <details className="mt-1">
          <summary className="cursor-pointer text-[14px] font-semibold">평가 근거</summary>
          <p className="mt-2 text-[14px] leading-[22px] text-secondary">{q.rationale}</p>
        </details>
      </div>

      {q.contradictions.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[20px] border border-ink p-4" data-testid="contradictions">
          <p className="text-[15px] font-bold">자료와 다른 점 {q.contradictions.length}</p>
          {q.contradictions.map((c, k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <p className="text-[15px] leading-[22px] [overflow-wrap:anywhere]">
                <span className="font-semibold">말한 내용</span> {soft(c.claim)}
              </p>
              <p className="text-[15px] leading-[22px] text-secondary [overflow-wrap:anywhere]">
                <span className="font-semibold text-ink">자료</span> {soft(c.docSays)}
              </p>
              <RefChips refs={c.refs} docIds={docIds} />
            </div>
          ))}
        </div>
      )}

      {q.missing.length > 0 && (
        <div>
          <Label>좋은 답변에 필요했던 것</Label>
          <ul className="mt-2 flex flex-col gap-1.5">
            {q.missing.map((m, k) => (
              <li key={k} className="flex gap-2 text-[15px] leading-[22px]">
                <span aria-hidden>·</span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card tone="card" className="!rounded-[20px]">
        <Label>이렇게 답해 보세요</Label>
        <p className="mt-2 text-[17px] font-semibold leading-[27px]" data-testid="improved">
          {q.improvedAnswer}
        </p>
        <div className="mt-3">
          <RefChips refs={q.citations} docIds={docIds} max={3} />
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <button type="button" disabled={i === 0} onClick={() => onIndex(i - 1)} className="h-11 rounded-full px-4 text-[16px] font-semibold disabled:text-line">
          이전
        </button>
        <span className="text-[14px] font-semibold text-secondary tabular">
          {i + 1} / {n}
        </span>
        <button type="button" disabled={i === n - 1} onClick={() => onIndex(i + 1)} className="flex h-11 items-center gap-1 rounded-full px-4 text-[16px] font-semibold disabled:text-line" data-testid="next-q">
          다음 질문 보기 <Arrow />
        </button>
      </div>
    </div>
  );
}

const RATE_KO = { slow: "느림", ok: "적정", fast: "빠름" } as const;
const TIME_KO = { short: "짧음", ok: "적정", over: "초과" } as const;
const COVER_KO = { covered: "다룸", partial: "일부", missing: "누락" } as const;

function Stat({ label, value, unit, note, flag }: { label: string; value: string | number; unit?: string; note?: string; flag?: string }) {
  return (
    <div className="flex flex-col rounded-[20px] bg-surface p-4">
      <span className="flex items-center justify-between text-[14px] font-medium leading-5 text-secondary">
        {label}
        {flag && <span className={`rounded-full px-2 text-[12px] font-semibold ${flag === "적정" ? "bg-canvas text-ink" : "bg-ink text-inverse"}`}>{flag}</span>}
      </span>
      <span className="mt-1 text-[32px] font-bold leading-10 tracking-[-1px] tabular">
        {value}
        {unit && <span className="ml-1 text-[15px] font-semibold tracking-normal text-secondary">{unit}</span>}
      </span>
      {note && <span className="text-[12px] leading-[18px] text-secondary">{note}</span>}
    </div>
  );
}

function highlight(text: string, words: string[]) {
  const set = new Set(words);
  return text.split(/(\s+)/).map((tok, i) => {
    const w = tok.replace(/^[\s"'(,.…~!?]+|[\s"'),.…~!?]+$/g, "");
    return set.has(w) || set.has(w.replace(/요$/, "")) ? (
      <mark key={i} className="rounded bg-ink px-0.5 text-inverse">
        {tok}
      </mark>
    ) : (
      <span key={i}>{tok}</span>
    );
  });
}

function SpeechPanel({ report }: { report: Report }) {
  const m = report.speech.metrics;
  const a = report.speech.analysis;
  const maxBar = Math.max(1, ...m.rateTimeline.map((x) => x.syllables), 340);
  return (
    <div className="flex flex-col gap-5" data-testid="speech-panel">
      <h3 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">발표 분석</h3>

      <Card>
        <div className="flex items-start justify-between">
          <div>
            <Label>전달 점수 (코드 계산)</Label>
            <p className="text-[56px] font-bold leading-[64px] tracking-[-2px] tabular" data-testid="delivery">
              {m.deliveryScore}
            </p>
          </div>
          <Pill tone="canvas">발표력 {report.overall.sub.delivery ?? "-"}</Pill>
        </div>
        {m.deliveryPenalties.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {m.deliveryPenalties.map((p, i) => (
              <li key={i} className="flex justify-between text-[15px] leading-[22px]">
                <span>{p.reason}</span>
                <span className="font-semibold tabular">−{p.points}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[15px] text-secondary">감점 요인이 없어요.</p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="말 속도" value={m.syllablesPerMinute} unit="음절/분" note="적정 240–340" flag={RATE_KO[m.rateStatus]} />
        <Stat label="시간 사용" value={fmtSec(m.spokenSeconds)} unit={`/ ${fmtSec(m.targetSeconds)}`} note={`${Math.round(m.timeUsage * 100)}% 사용`} flag={TIME_KO[m.timeStatus]} />
        <Stat label="군말" value={m.fillers.total} unit="회" note={`분당 ${m.fillers.perMinute}회 · 100음절당 ${m.fillers.per100Syllables}`} flag={m.fillers.perMinute > 2 ? "많음" : "적정"} />
        <Stat label="긴 침묵" value={m.pauses.count} unit="회" note={m.pauses.count ? `최장 ${m.pauses.longest}초 (${m.pauses.threshold}초 이상)` : `${m.pauses.threshold}초 이상 없음`} />
        <Stat label="문장 길이" value={m.avgSentenceSyllables} unit="음절" note={`최장 ${m.maxSentenceSyllables}음절 · 60음절↑ ${m.longSentences}개`} />
        <Stat label="문장 속도" value={m.sentencesPerMinute} unit="문장/분" note={`전체 ${m.sentenceCount}문장 · ${m.syllables.toLocaleString()}음절`} />
      </div>

      {m.rateTimeline.length > 0 && (
        <div className="rounded-[20px] border border-line p-4">
          <p className="text-[15px] font-semibold">분 단위 말 속도</p>
          <p className="text-[12px] text-secondary">막대 = 그 1분 동안 시작한 문장의 음절 수 · 점선 = 적정 상한 340</p>
          <div className="relative mt-3 flex h-28 items-end gap-2" role="img" aria-label={`분 단위 음절 수: ${m.rateTimeline.map((x) => `${x.minute}분 ${x.syllables}`).join(", ")}`}>
            <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-secondary" style={{ bottom: `${(340 / maxBar) * 100}%` }} aria-hidden />
            {m.rateTimeline.map((x) => (
              <div key={x.minute} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] font-semibold tabular">{x.syllables}</span>
                <span className="w-full max-w-10 rounded-t-[8px] bg-ink" style={{ height: `${(x.syllables / maxBar) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-2">
            {m.rateTimeline.map((x) => (
              <span key={x.minute} className="flex-1 text-center text-[11px] text-secondary tabular">
                {x.minute}분
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-[20px] border border-line p-4">
        <p className="text-[15px] font-semibold">군말·습관어</p>
        {m.fillers.byWord.length ? (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.fillers.byWord.map((f) => (
                <Pill key={`${f.kind}${f.word}`} tone={f.kind === "hesitation" ? "ink" : "surface"} title={f.kind === "hesitation" ? "간투사" : "습관어"}>
                  {f.word} ×{f.count}
                </Pill>
              ))}
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {m.fillers.examples.slice(0, 4).map((e) => (
                <li key={e.index} className="text-[14px] leading-[22px]">
                  <span className="mr-1 text-secondary tabular">{fmtSec(e.t)}</span>
                  {highlight(e.text, e.words)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-[14px] text-secondary">군말이 거의 없었어요.</p>
        )}
        {m.repetition.length > 0 && (
          <p className="mt-3 text-[14px] leading-[22px]">
            <span className="font-semibold">반복 표현</span>{" "}
            {m.repetition.map((r) => `${r.kind === "opener" ? "문장 시작 " : r.kind === "stutter" ? "더듬기 " : ""}“${r.text}” ${r.count}회`).join(" · ")}
          </p>
        )}
        {m.pauses.items.length > 0 && (
          <p className="mt-2 text-[14px] leading-[22px]">
            <span className="font-semibold">긴 침묵</span> {m.pauses.items.map((p) => `${fmtSec(p.t)} (${p.seconds}초)`).join(" · ")}
          </p>
        )}
      </div>

      {a ? (
        <>
          <Card tone="surface">
            <H2>내용 평가</H2>
            <p className="mt-2 text-[15px] leading-[23px]">{a.summary}</p>
            <div className="mt-4 flex flex-col gap-3">
              <Meter label="구조" value={a.scores.structure} note={a.structureNote} />
              <Meter label="명료성" value={a.scores.clarity} note={a.clarityNote} />
              <Meter label="설득력" value={a.scores.persuasiveness} note={a.persuasivenessNote} />
            </div>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card tone="surface">
              <H2>잘한 점</H2>
              <ul className="mt-2 flex flex-col gap-2">
                {a.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[15px] leading-[22px]">
                    <CheckIcon size={20} />
                    {s}
                  </li>
                ))}
              </ul>
            </Card>
            <Card tone="surface">
              <H2>다음 연습에서는</H2>
              <ul className="mt-2 flex flex-col gap-2">
                {a.improvements.map((s, i) => (
                  <li key={i} className="text-[15px] leading-[22px]">
                    {i + 1}. {s}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {a.numberIssues.length > 0 && (
            <div className="flex flex-col gap-3 rounded-[20px] border border-ink p-4" data-testid="number-issues">
              <p className="text-[15px] font-bold">발표 중 수치가 자료와 달라요 {a.numberIssues.filter((c) => !c.matchesDoc).length}</p>
              {a.numberIssues.some((c) => c.matchesDoc) && (
                <p className="-mt-2 text-[13px] leading-5 text-secondary">
                  ‘자료끼리 달라요’는 발표자가 자료 중 한쪽의 수치를 그대로 말한 경우예요. 발표 감점은 없고, 자료 품질의 수치 대조에서 다뤄요.
                </p>
              )}
              {a.numberIssues.map((c, k) => (
                <div key={k} className="flex flex-col gap-1.5" data-matches-doc={c.matchesDoc ? c.matchesDoc : undefined}>
                  <p className="text-[15px] leading-[22px] [overflow-wrap:anywhere]">
                    <span className="font-semibold">말한 내용</span> {soft(c.claim)}{" "}
                    <span className="text-[12px] text-secondary">({c.matchesDoc ? `자료끼리 달라요 · ${DOC_LABEL[c.matchesDoc]} 수치와 일치 · 감점 없음` : SEVERITY_KO[c.severity]})</span>
                  </p>
                  <p className="text-[15px] leading-[22px] text-secondary [overflow-wrap:anywhere]">
                    <span className="font-semibold text-ink">자료</span> {soft(c.docSays)}
                  </p>
                  <RefChips refs={c.refs} docIds={report.meta.docIds} />
                </div>
              ))}
            </div>
          )}

          <div className="rounded-[20px] border border-line p-4" data-testid="coverage">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-semibold">슬라이드 커버리지</p>
              <Pill>{Math.round(a.coverageRate * 100)}%</Pill>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {a.coverage.map((c) => (
                <li key={c.page} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-2 py-2.5">
                  <span className="text-[14px] font-semibold text-secondary tabular">p.{c.page}</span>
                  <span>
                    <span className="block text-[15px] font-semibold leading-[22px]">{c.title}</span>
                    {c.status !== "covered" && <span className="block text-[13px] leading-5 text-secondary">{c.note}</span>}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${c.status === "covered" ? "bg-ink text-inverse" : c.status === "partial" ? "border border-ink" : "border border-dashed border-secondary text-secondary"}`}
                  >
                    {COVER_KO[c.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <Card tone="surface">내용 분석을 만들지 못했어요. (전달 지표만 표시)</Card>
      )}
    </div>
  );
}

const CATEGORY_KO = { structure: "구성", logic: "논리", evidence: "근거", consistency: "일관성", clarity: "명료성" } as const;

function MaterialsPanel({ report }: { report: Report }) {
  const mat = report.materials;
  const docIds = report.meta.docIds;
  return (
    <div className="flex flex-col gap-5" data-testid="materials-panel">
      <div className="flex items-end justify-between">
        <h3 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">자료 품질</h3>
        <ScoreBadge score={mat.score} />
      </div>
      {mat.docs.map((d) => (
        <Card key={d.role} tone="surface" className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <H2>{DOC_LABEL[d.role]}</H2>
              <p className="truncate text-[14px] text-secondary">
                {d.filename} · {d.pageCount}쪽
              </p>
            </div>
            <span className="text-[40px] font-bold leading-[44px] tracking-[-1.5px] tabular">{d.score}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            <Meter label="구성" value={d.scores.structure} />
            <Meter label="논리" value={d.scores.logic} />
            <Meter label="근거" value={d.scores.evidence} />
            <Meter label="일관성" value={d.scores.consistency} />
            <Meter label="명료성" value={d.scores.clarity} />
          </div>
          <p className="text-[15px] leading-[23px]">{d.summary}</p>
          {d.strengths.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {d.strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-[14px] leading-[21px]">
                  <CheckIcon size={18} />
                  {s}
                </li>
              ))}
            </ul>
          )}
          <ul className="flex flex-col gap-3">
            {d.issues.map((it, i) => (
              <li key={i} className="rounded-[20px] bg-canvas p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${it.severity === "high" ? "bg-ink text-inverse" : "border border-line"}`}>{SEVERITY_KO[it.severity]}</span>
                  <span className="text-[12px] font-semibold text-secondary">{CATEGORY_KO[it.category]}</span>
                </div>
                <p className="mt-1.5 text-[16px] font-semibold leading-6">{it.title}</p>
                <p className="mt-1 text-[14px] leading-[22px] text-secondary">{it.detail}</p>
                <p className="mt-2 text-[14px] leading-[22px]">
                  <span className="font-semibold">고치는 법</span> {it.fix}
                </p>
                <div className="mt-2">
                  <RefChips refs={it.refs} docIds={docIds} max={3} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {mat.consistency.length > 0 && (
        <div className="rounded-[20px] border border-line p-4" data-testid="consistency">
          <p className="text-[15px] font-semibold">발표자료 ↔ 제안자료 수치 대조</p>
          <p className="text-[12px] text-secondary">
            불일치 {mat.consistency.filter((r) => r.status === "mismatch").length}건 · 쪽 번호는 원문에서 값을 다시 찾아 확인
          </p>
          <ul className="mt-2 divide-y divide-line">
            {mat.consistency.map((r, i) => (
              <li key={i} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_56px] sm:items-start sm:gap-3">
                <span className="text-[15px] font-semibold leading-[22px]">{r.metric}</span>
                <CellVal label="발표자료" v={r.presentation} docId={docIds.presentation} />
                <CellVal label="제안자료" v={r.proposal} docId={docIds.proposal} />
                <span
                  className={`w-fit rounded-full px-2 py-0.5 text-[12px] font-semibold ${r.status === "mismatch" ? "bg-ink text-inverse" : r.status === "match" ? "border border-line" : "border border-dashed border-secondary text-secondary"}`}
                >
                  {r.status === "mismatch" ? "불일치" : r.status === "match" ? "일치" : "한쪽만"}
                </span>
                {r.note && r.status === "mismatch" && <span className="text-[13px] leading-5 text-secondary sm:col-span-4">{r.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CellVal({ label, v, docId }: { label: string; v: { value: string; pages: number[] } | null; docId?: string }) {
  if (!v) return <span className="text-[14px] text-secondary">{label} —</span>;
  return (
    <span className="text-[14px] leading-[21px]">
      <span className="text-secondary sm:hidden">{label} </span>
      <span className="font-semibold">{v.value}</span>{" "}
      {v.pages.slice(0, 3).map((p) =>
        docId ? (
          <a key={p} href={`/api/wiki/docs/${docId}/pdf#page=${p}`} target="_blank" rel="noreferrer" className="text-secondary underline tabular">
            p.{p}
          </a>
        ) : (
          <span key={p} className="text-secondary tabular">
            p.{p}
          </span>
        ),
      ).reduce<React.ReactNode[]>((acc, el, k) => (k ? [...acc, " ", el] : [el]), [])}
    </span>
  );
}
