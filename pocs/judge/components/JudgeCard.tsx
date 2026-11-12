"use client";
import { TEMPERAMENT_LABEL, type Temperament } from "@/lib/types";
import { judgeSrcSet, QUALITY_LABEL, type ImageQuality, type JudgeRecord } from "../lib/model";
import type { UiError } from "./api";
import { IconAlert, IconClose, IconRefresh, IconTrash } from "./icons";

export const genderKo = (g: "male" | "female") => (g === "male" ? "남성" : "여성");
export const decadeKo = (age: number) => `${Math.floor(age / 10) * 10}대`;
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}초`;

export function TemperamentTag({ t, inverse = false }: { t: Temperament; inverse?: boolean }) {
  return (
    <span
      className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap ${
        inverse ? "bg-ink text-inverse" : "bg-canvas text-ink border border-line"
      }`}
    >
      {TEMPERAMENT_LABEL[t]}
    </span>
  );
}

const cardCls = "rounded-[28px] bg-surface p-2.5 sm:p-3 flex flex-col gap-3 min-w-0";
const photoCls = "relative aspect-square w-full overflow-hidden rounded-[20px] bg-card";

export function JudgeCard({
  judge,
  busy,
  onOpen,
  onRegenerate,
  onDelete,
}: {
  judge: JudgeRecord;
  busy?: { elapsedMs: number } | null;
  onOpen: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  return (
    <article className={cardCls} data-testid="judge-card" data-judge-id={judge.id} aria-busy={!!busy}>
      <button type="button" onClick={onOpen} className={`${photoCls} group`} aria-label={`${judge.fullName} 상세 보기`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own API with immutable cache */}
        <img
          src={`${judge.imageUrl}?size=card`}
          srcSet={judgeSrcSet(judge)}
          sizes="(min-width: 1024px) 210px, (min-width: 640px) 31vw, 46vw"
          alt={`${judge.fullName} 심사위원 (${TEMPERAMENT_LABEL[judge.temperament]}, ${genderKo(judge.gender)} ${judge.age}세)`}
          className={`h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] ${busy ? "opacity-40" : ""}`}
          loading="lazy"
          decoding="async"
        />
        {busy && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-ink">
            <span className="h-8 w-8 rounded-full border-2 border-ink border-t-transparent animate-spin" aria-hidden />
            <span className="text-sm font-semibold">다시 생성 중</span>
            <span className="text-xs tabular">{secs(busy.elapsedMs)}</span>
          </span>
        )}
      </button>
      <div className="px-1.5 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <h3 className="text-lg sm:text-xl font-semibold tracking-[-0.4px] truncate">{judge.fullName}</h3>
          <TemperamentTag t={judge.temperament} inverse />
        </div>
        <p className="text-sm text-secondary truncate">
          {decadeKo(judge.age)} · {genderKo(judge.gender)} · <span className="tabular">{judge.age}세</span>
        </p>
        <p className="text-xs text-secondary tabular">
          {secs(judge.ms)} · {QUALITY_LABEL[judge.quality].label}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={!!busy}
          className="flex-1 min-w-0 h-11 rounded-full bg-canvas text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40 hover:bg-card transition-colors"
        >
          <IconRefresh /> <span className="truncate">다시 생성</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!!busy}
          className="h-11 w-11 shrink-0 rounded-full bg-canvas inline-flex items-center justify-center disabled:opacity-40 hover:bg-card transition-colors"
          aria-label={`${judge.fullName} 삭제`}
        >
          <IconTrash />
        </button>
      </div>
    </article>
  );
}

export function SkeletonCard({ temperament, quality, elapsedMs }: { temperament: Temperament; quality: ImageQuality; elapsedMs: number }) {
  return (
    <article className={cardCls} data-testid="judge-skeleton" aria-busy="true" aria-label={`${TEMPERAMENT_LABEL[temperament]} 심사위원 생성 중`}>
      <div className={`${photoCls} animate-pulse flex flex-col items-center justify-center gap-1`}>
        <span className="text-sm font-semibold text-ink">얼굴 생성 중</span>
        <span className="text-2xl font-semibold tracking-[-1px] tabular">{secs(elapsedMs)}</span>
        <span className="text-xs text-secondary">{QUALITY_LABEL[quality].eta}</span>
      </div>
      <div className="px-1.5 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="h-6 w-20 rounded-full bg-card animate-pulse" />
          <TemperamentTag t={temperament} />
        </div>
        <span className="h-4 w-24 rounded-full bg-card animate-pulse" />
        <span className="h-3 w-16 rounded-full bg-card animate-pulse" />
      </div>
      <div className="h-11 rounded-full bg-card animate-pulse" />
    </article>
  );
}

export function ErrorCard({ temperament, error, onRetry, onDismiss }: { temperament: Temperament; error: UiError; onRetry: () => void; onDismiss: () => void }) {
  return (
    <article className={cardCls} data-testid="judge-error" data-error-kind={error.kind} role="alert">
      <div className={`${photoCls} border border-line flex flex-col items-center justify-center gap-2 p-3 text-center`}>
        <IconAlert className="w-7 h-7 shrink-0 text-error" />
        <p className="text-sm font-semibold text-error leading-5">{error.title}</p>
        <p className="text-xs text-secondary leading-[18px]">{error.hint}</p>
      </div>
      <div className="px-1.5 flex items-center justify-between gap-2">
        <span className="text-sm text-secondary">생성 실패</span>
        <TemperamentTag t={temperament} />
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onRetry} className="flex-1 h-11 rounded-full bg-ink text-inverse text-sm font-semibold inline-flex items-center justify-center gap-1.5">
          <IconRefresh /> 다시 시도
        </button>
        <button type="button" onClick={onDismiss} className="h-11 w-11 shrink-0 rounded-full bg-canvas inline-flex items-center justify-center" aria-label="오류 닫기">
          <IconClose />
        </button>
      </div>
    </article>
  );
}
