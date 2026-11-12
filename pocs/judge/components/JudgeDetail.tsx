"use client";
import { useEffect, useRef } from "react";
import { TEMPERAMENT_LABEL } from "@/lib/types";
import { QUALITY_LABEL, type JudgeRecord } from "../lib/model";
import { decadeKo, genderKo, secs, TemperamentTag } from "./JudgeCard";
import { IconClose, IconRefresh, IconTrash } from "./icons";

const TRAIT_ROWS: [keyof JudgeRecord["traits"], string][] = [
  ["demeanor", "표정·태도"],
  ["hair", "헤어"],
  ["facialHair", "수염"],
  ["glasses", "안경"],
  ["attire", "복장"],
  ["setting", "배경"],
  ["lighting", "조명"],
];

export function JudgeDetail({
  judge,
  busy,
  onClose,
  onRegenerate,
  onDelete,
}: {
  judge: JudgeRecord | null;
  /** Set while a regenerate for this judge is in flight: shows progress and locks the actions. */
  busy?: { elapsedMs: number } | null;
  onClose: () => void;
  onRegenerate: (j: JudgeRecord) => void;
  onDelete: (j: JudgeRecord) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (judge && !d.open) d.showModal();
    if (!judge && d.open) d.close();
  }, [judge]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="judge-detail-title"
      className="m-0 mt-auto sm:m-auto w-full max-w-none sm:max-w-[560px] max-h-[92dvh] rounded-t-[28px] sm:rounded-[28px] bg-canvas text-ink p-0 backdrop:bg-black/40"
      data-testid="judge-detail"
    >
      {judge && (
        <div className="flex flex-col gap-5 p-6 pb-[calc(24px+env(safe-area-inset-bottom))] break-keep">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <p className="text-sm font-medium text-secondary">심사위원 · {TEMPERAMENT_LABEL[judge.temperament]}</p>
              <h2 id="judge-detail-title" className="text-[28px] leading-9 font-bold tracking-[-0.8px]">
                {judge.fullName}
              </h2>
              <p className="text-secondary">
                {decadeKo(judge.age)} {genderKo(judge.gender)} · <span className="tabular">{judge.age}세</span>
              </p>
            </div>
            <button type="button" onClick={onClose} className="h-11 w-11 shrink-0 rounded-full bg-surface inline-flex items-center justify-center" aria-label="닫기">
              <IconClose />
            </button>
          </div>

          <div className="relative mx-auto w-full max-w-[360px] aspect-square overflow-hidden rounded-[28px] bg-card" aria-busy={!!busy}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={judge.imageUrl}
              alt={`${judge.fullName} 얼굴`}
              className={`h-full w-full object-cover transition-opacity ${busy ? "opacity-30" : ""}`}
            />
            {busy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink" data-testid="detail-regenerating">
                <span className="h-9 w-9 rounded-full border-2 border-ink border-t-transparent animate-spin" aria-hidden />
                <span className="font-semibold">같은 성향의 새 인물 생성 중</span>
                <span className="text-2xl font-semibold tracking-[-1px] tabular">{secs(busy.elapsedMs)}</span>
                <span className="text-xs text-secondary">{QUALITY_LABEL[judge.quality].eta} · 완료되면 이 자리에서 바뀌어요</span>
              </div>
            )}
          </div>

          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-secondary">성향</dt>
            <dd>
              <TemperamentTag t={judge.temperament} inverse />
            </dd>
            <dt className="text-secondary">TTS 힌트</dt>
            <dd>{judge.voiceHint}</dd>
            <dt className="text-secondary">생성</dt>
            <dd className="tabular">
              {judge.model} · {QUALITY_LABEL[judge.quality].label}({judge.quality}) · {judge.size} · {Math.round(judge.bytes / 1024)}KB
            </dd>
            <dt className="text-secondary">지연</dt>
            <dd className="tabular">
              API {secs(judge.ms)} · 저장 포함 {secs(judge.totalMs)}
            </dd>
            <dt className="text-secondary">ID</dt>
            <dd className="tabular text-secondary break-all">{judge.id}</dd>
          </dl>

          <details className="rounded-[20px] bg-surface p-4 group">
            <summary className="cursor-pointer font-semibold list-none flex items-center justify-between">
              랜덤 요소 (영문 프롬프트 조각)
              <span className="text-secondary text-sm group-open:hidden">펼치기</span>
              <span className="text-secondary text-sm hidden group-open:inline">접기</span>
            </summary>
            <dl className="mt-3 grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-xs leading-[18px]">
              {TRAIT_ROWS.map(([k, label]) => (
                <div key={k} className="contents">
                  <dt className="text-secondary">{label}</dt>
                  <dd>{String(judge.traits[k] ?? "없음")}</dd>
                </div>
              ))}
            </dl>
          </details>

          <details className="rounded-[20px] bg-surface p-4 group" data-testid="judge-prompt">
            <summary className="cursor-pointer font-semibold list-none flex items-center justify-between">
              생성 프롬프트
              <span className="text-secondary text-sm group-open:hidden">펼치기</span>
              <span className="text-secondary text-sm hidden group-open:inline">접기</span>
            </summary>
            <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-[18px] font-mono text-ink">{judge.prompt}</pre>
          </details>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onRegenerate(judge)}
              disabled={!!busy}
              aria-busy={!!busy}
              data-testid="detail-regenerate"
              className="flex-1 h-14 rounded-[20px] bg-ink text-inverse font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {busy ? (
                <>
                  <span className="h-5 w-5 rounded-full border-2 border-inverse border-t-transparent animate-spin" aria-hidden /> 다시 생성 중…
                </>
              ) : (
                <>
                  <IconRefresh className="w-5 h-5" /> 같은 성향으로 다시 생성
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => onDelete(judge)}
              disabled={!!busy}
              className="h-14 w-14 rounded-[20px] bg-surface inline-flex items-center justify-center disabled:opacity-40"
              aria-label={`${judge.fullName} 삭제`}
            >
              <IconTrash />
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
