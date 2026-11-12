"use client";
import Image from "next/image";
import { TEMPERAMENT_LABEL, type Temperament } from "@/lib/types";
import type { UiJudge } from "../lib/store";
import { PersonaChips } from "./Chip";
import { Close } from "./Icons";
import { Waveform } from "./Waveform";

/** Face image in full color (DESIGN.md "UI와 콘텐츠의 색상 범위": no grayscale on media) or initial placeholder when no face is generated yet.
 *  Eager by default: faces are above the fold wherever they appear (avoids next/image LCP warnings).
 *  (Never lazy: next/image tracks LCP by the src attribute, which is shared by every size of the same face.)
 *  Pass `secondary` for decorative avatars so React SSR doesn't emit unused image preloads. */
export function JudgeFace({
  judge,
  sizes,
  className = "",
  priority,
  secondary,
}: {
  judge: Pick<UiJudge, "name" | "imageUrl">;
  sizes: string;
  className?: string;
  priority?: boolean;
  /** Secondary/decorative instance: fetchPriority="low" so React SSR doesn't emit an image preload for it. */
  secondary?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden bg-card ${className}`}>
      {judge.imageUrl ? (
        <Image src={judge.imageUrl} alt={`${judge.name} 심사위원 얼굴`} fill sizes={sizes} className="object-cover" preload={priority} loading={priority ? undefined : "eager"} fetchPriority={secondary ? "low" : undefined} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-secondary" aria-label={`${judge.name} (얼굴 생성 전)`} role="img">
          <span className="text-[40%] font-bold" style={{ fontSize: "clamp(16px, 40cqw, 56px)" }}>
            {judge.name.slice(0, 1)}
          </span>
        </div>
      )}
    </div>
  );
}

export function JudgeAvatar({ judge, size = 56, secondary }: { judge: Pick<UiJudge, "name" | "imageUrl">; size?: number; secondary?: boolean }) {
  return (
    <div style={{ width: size, height: size }} className="@container shrink-0">
      <JudgeFace judge={judge} sizes={`${size}px`} className="h-full w-full rounded-full" secondary={secondary} />
    </div>
  );
}

export function personaText(j: { name: string; temperament: Temperament }) {
  return `${j.name} · ${TEMPERAMENT_LABEL[j.temperament]}`;
}

/** Setup row: face, name, role, persona chips (single select), remove. */
export function JudgeRow({ judge, onChange, onRemove }: { judge: UiJudge; onChange: (t: Temperament) => void; onRemove: () => void }) {
  return (
    <li className="ui-enter flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-[20px] bg-surface p-3 pl-3.5">
      <JudgeAvatar judge={judge} size={52} />
      <div className="min-w-0 flex-1 border-l border-line pl-3">
        <p className="text-[17px] font-bold leading-6">{judge.name}</p>
        <p className="truncate text-[12px] leading-[18px] text-secondary">{judge.role ?? "투자심사위원"}</p>
      </div>
      <div className="order-last w-full pl-[64px] sm:order-none sm:w-auto sm:pl-0">
        <PersonaChips name={judge.name} value={judge.temperament} onChange={onChange} />
      </div>
      <button type="button" onClick={onRemove} aria-label={`${judge.name} 심사위원 삭제`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-card">
        <Close size={20} />
      </button>
    </li>
  );
}

/** Presentation tile: face + "이름 · 성향". */
export function JudgeTile({ judge, active }: { judge: UiJudge; active?: boolean }) {
  return (
    <figure className="flex min-w-0 flex-col items-center gap-1.5">
      <div className="@container relative aspect-[1/1.02] w-full">
        <JudgeFace judge={judge} sizes="(min-width:1024px) 140px, 33vw" className="h-full w-full rounded-[20px]" />
        {active && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-ink ring-2 ring-canvas" aria-hidden="true" />}
      </div>
      <figcaption className="truncate text-[13px] leading-5">
        <span className="font-bold">{judge.name}</span>
        <span className="text-secondary"> · {TEMPERAMENT_LABEL[judge.temperament]}</span>
      </figcaption>
    </figure>
  );
}

/** Review hero: large face card with "이름 · 성향" badge and "질문 중" pill. */
export function JudgeHero({ judge, speaking }: { judge: UiJudge; speaking: boolean }) {
  return (
    <div className="@container relative aspect-[4/3.3] w-full lg:aspect-[4/3.6]">
      <JudgeFace judge={judge} sizes="(min-width:1024px) 520px, 100vw" className="h-full w-full rounded-[28px]" priority />
      <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
        <span className="inline-flex h-10 items-center rounded-full bg-canvas px-4 text-[15px] font-bold">{personaText(judge)}</span>
        <span className="inline-flex h-10 items-center gap-2 rounded-full bg-ink/70 px-3.5 text-[14px] font-semibold text-inverse backdrop-blur-sm" aria-live="polite">
          <Waveform bars={5} active={speaking} className="h-4 text-inverse" />
          {speaking ? "질문 중" : "답변 듣는 중"}
        </span>
      </div>
    </div>
  );
}
