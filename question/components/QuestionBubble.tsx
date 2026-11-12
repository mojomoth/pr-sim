"use client";
import type { Evidence, GeneratedQuestion, QJudge } from "../lib/types";
import { Face, Tag, TemperamentTag } from "./ui";

const DOC_LABEL: Record<Evidence["doc"], string> = { presentation: "발표자료", proposal: "제안자료", transcript: "발표 전사" };

export function EvidenceList({ evidence, docIds }: { evidence: Evidence[]; docIds: { presentation?: string; proposal?: string } }) {
  return (
    <ul className="space-y-2">
      {evidence.map((e, i) => {
        const page = e.correctedPage ?? e.page;
        const docId = e.doc === "transcript" ? undefined : docIds[e.doc];
        return (
          <li key={i} className="rounded-[16px] border border-line bg-canvas px-3 py-2 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
              <span className="font-medium text-ink">{DOC_LABEL[e.doc]}</span>
              {page ? (
                docId ? (
                  <a className="underline underline-offset-2" href={`/api/wiki/docs/${docId}/pdf#page=${page}`} target="_blank" rel="noreferrer">
                    p.{page}
                  </a>
                ) : (
                  <span>p.{page}</span>
                )
              ) : null}
              {e.correctedPage && e.page !== e.correctedPage ? <span>(모델 표기 p.{e.page ?? "–"} → 원문 검색으로 보정)</span> : null}
              {e.verified ? <Tag tone="line">✓ 원문 확인</Tag> : <Tag tone="error">원문 불일치</Tag>}
            </div>
            <q className="block whitespace-pre-line break-words text-ink">{e.quote.replace(/\s*\n\s*/g, " ")}</q>
          </li>
        );
      })}
    </ul>
  );
}

export function QuestionBubble({
  q,
  judge,
  docIds,
  partial,
  active,
  compact,
}: {
  q?: GeneratedQuestion;
  judge?: QJudge;
  docIds: { presentation?: string; proposal?: string };
  partial?: string;
  active?: boolean;
  compact?: boolean;
}) {
  const text = q?.question ?? partial ?? "";
  return (
    <div className={`rounded-[20px] p-4 ${active ? "bg-card" : "bg-surface"}`} data-testid={q ? "question" : "question-partial"} data-qid={q?.id}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {judge ? <Face name={judge.name} imageUrl={judge.imageUrl} className="h-8 w-8" /> : null}
        {judge ? <span className="text-sm font-semibold">{judge.name}</span> : null}
        {judge ? <TemperamentTag t={judge.temperament} /> : null}
        {q ? (
          <>
            <Tag tone="line">{q.kind === "main" ? "본질문" : q.kind === "reserve" ? "예비" : "꼬리질문"}</Tag>
            <span className="tabular text-xs text-secondary" aria-label={`난이도 ${q.difficulty}`}>
              난이도 {"●".repeat(q.difficulty)}
              {"○".repeat(5 - q.difficulty)}
            </span>
            {q.targetId ? <span className="text-xs text-secondary">{q.targetId}</span> : null}
          </>
        ) : (
          <span className="text-xs text-secondary">생성 중…</span>
        )}
      </div>
      <p className={`${compact ? "text-[15px]" : "text-[17px]"} font-semibold leading-7 tracking-[-0.3px]`}>
        {text}
        {!q ? <span className="ml-0.5 inline-block w-2 animate-pulse">▍</span> : null}
      </p>
      {q ? (
        <details className="mt-2 group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-secondary">
            <span className="transition-transform group-open:rotate-90">›</span> 근거 {q.evidence.length}개 · {q.evidence.filter((e) => e.verified).length}개 원문 확인
          </summary>
          <div className="mt-1 space-y-2">
            <p className="text-sm text-secondary">
              <span className="font-medium text-ink">의도</span> {q.intent}
            </p>
            <p className="text-sm text-secondary">
              <span className="font-medium text-ink">겨냥한 주장</span> {q.targetClaim}
            </p>
            <EvidenceList evidence={q.evidence} docIds={docIds} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
