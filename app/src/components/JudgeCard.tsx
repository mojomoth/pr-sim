import { Waveform } from "./Waveform";

/** What every judge component needs. `persona` is the visible label (친절함 / 빡셈 / 공격적). */
export interface JudgeView {
  name: string;
  persona: string;
  /** Color face (object URL or path). Missing → initial placeholder, or a pulse while `pending`. */
  imageUrl?: string;
  pending?: boolean;
}

/** Face in full color (never grayscale — DESIGN.md "UI와 콘텐츠의 색상 범위"). */
function JudgeFace({ judge, className = "" }: { judge: JudgeView; className?: string }) {
  return (
    <div className={`@container relative overflow-hidden bg-card ${className}`}>
      {judge.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: object URLs from IndexedDB; next/image adds nothing here
        <img src={judge.imageUrl} alt={`${judge.name} 심사위원 얼굴`} className="absolute inset-0 h-full w-full object-cover" decoding="async" draggable={false} />
      ) : judge.pending ? (
        <div className="absolute inset-0 animate-pulse bg-line" role="img" aria-label={`${judge.name} 얼굴 만드는 중`} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-secondary" role="img" aria-label={judge.name}>
          <span className="font-bold" style={{ fontSize: "clamp(16px, 40cqw, 56px)" }}>
            {judge.name.slice(0, 1)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Round face thumbnail (feedback cards, history). */
export function JudgeAvatar({ judge, size = 56 }: { judge: JudgeView; size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="shrink-0">
      <JudgeFace judge={judge} className="h-full w-full rounded-full" />
    </div>
  );
}

/** Presentation tile: face + "이름 · 성향"; `speaking` adds a black ring and a waveform badge. */
export function JudgeTile({ judge, speaking }: { judge: JudgeView; speaking?: boolean }) {
  return (
    <figure className="flex min-w-0 flex-col items-center gap-1.5">
      <div className={`relative aspect-[1/1.02] w-full rounded-[20px] ${speaking ? "ring-2 ring-ink ring-offset-2 ring-offset-canvas" : ""}`}>
        <JudgeFace judge={judge} className="h-full w-full rounded-[20px]" />
        {speaking && (
          <span className="absolute right-1.5 top-1.5 inline-flex h-6 items-center rounded-full bg-ink/75 px-1.5 text-inverse">
            <Waveform bars={4} className="h-3" />
            <span className="sr-only">말하는 중</span>
          </span>
        )}
      </div>
      <figcaption className="max-w-full truncate text-[13px] leading-5">
        <span className="font-bold">{judge.name}</span>
        <span className="text-secondary"> · {judge.persona}</span>
      </figcaption>
    </figure>
  );
}

/** What the Q&A hero's pill says. `ended` hides the pill (nobody is asking or listening any more). */
export type JudgeHeroStatus = "asking" | "listening" | "judging" | "ended";
const HERO_STATUS: Record<Exclude<JudgeHeroStatus, "ended">, string> = {
  asking: "질문 중",
  listening: "답변 듣는 중",
  judging: "답변 살펴보는 중",
};

/**
 * Q&A hero: large face card with "이름 · 성향" badge and a status pill (질문 중 / 답변 듣는 중 /
 * 답변 살펴보는 중; none once ended). `status` wins over the legacy `speaking` flag
 * (speaking → asking, otherwise listening).
 */
export function JudgeHero({ judge, speaking, status }: { judge: JudgeView; speaking?: boolean; status?: JudgeHeroStatus }) {
  const s: JudgeHeroStatus = status ?? (speaking ? "asking" : "listening");
  return (
    <div className="relative aspect-[4/3.3] w-full">
      <JudgeFace judge={judge} className="h-full w-full rounded-[28px]" />
      <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
        <span className="inline-flex h-10 min-w-0 items-center truncate rounded-full bg-canvas px-4 text-[15px] font-bold">
          {judge.name} · {judge.persona}
        </span>
        {s !== "ended" && (
          <span className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-ink/70 px-3.5 text-[14px] font-semibold text-inverse backdrop-blur-sm" aria-live="polite">
            <Waveform bars={5} active={s === "asking"} className="h-4" />
            {HERO_STATUS[s]}
          </span>
        )}
      </div>
    </div>
  );
}
