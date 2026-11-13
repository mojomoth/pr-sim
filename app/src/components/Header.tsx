"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "./Icons";

/**
 * Approved BI lockup (black P symbol + PR·SIM wordmark, assets/bi/lockup-black.png trimmed to its
 * alpha box → public/brand). Aspect ratio 517:160 kept, no color/effects; the vertical padding keeps
 * clear space ≥ 1/4 of the symbol width. `href={null}` renders it unlinked (live sessions).
 */
const LOCKUP_RATIO = 517 / 160;
export function Brand({ href = "/", tone = "black", height: h = 32 }: { href?: string | null; tone?: "black" | "white"; height?: number }) {
  const inner = (
    <span className="flex items-center py-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static raster logo at a fixed size */}
      <img src={`/brand/lockup-${tone}.png`} alt="PR·SIM" width={Math.round(h * LOCKUP_RATIO)} height={h} style={{ height: h, width: "auto" }} draggable={false} />
    </span>
  );
  if (!href) return inner;
  return (
    <Link href={href} aria-label="PR·SIM 홈" className="rounded-lg px-0.5">
      {inner}
    </Link>
  );
}

/** Gray pill used in headers (기록, 종료, 1 / 4 …). Renders a Link, a button, or a static label. */
export function HeaderPill({ href, onClick, children, label }: { href?: string; onClick?: () => void; children: React.ReactNode; label?: string }) {
  const cls = "inline-flex h-11 min-w-11 items-center justify-center rounded-full bg-surface px-4 text-[15px] font-semibold tabular";
  if (href)
    return (
      <Link href={href} className={cls} aria-label={label}>
        {children}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls} aria-label={label}>
        {children}
      </button>
    );
  return (
    <span className={cls} aria-label={label}>
      {children}
    </span>
  );
}

/** Back chevron: `onClick` (e.g. confirm before leaving a live session) > `href` > history back. */
function BackButton({ href, onClick, label = "뒤로 가기" }: { href?: string; onClick?: () => void; label?: string }) {
  const router = useRouter();
  const cls = "-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface";
  if (href && !onClick)
    return (
      <Link href={href} aria-label={label} className={cls}>
        <ChevronLeft size={26} />
      </Link>
    );
  return (
    <button type="button" aria-label={label} className={cls} onClick={onClick ?? (() => router.back())}>
      <ChevronLeft size={26} />
    </button>
  );
}

/** Top bar for list-style screens (02 설정, 07 목록): optional back chevron, lockup, right slot. */
export function BrandHeader({ right, backHref }: { right?: React.ReactNode; backHref?: string }) {
  return (
    <header className="flex h-14 items-center justify-between">
      <div className="flex items-center gap-1">
        {backHref && <BackButton href={backHref} />}
        <Brand />
      </div>
      {right}
    </header>
  );
}

/**
 * Step top bar (03–06): lockup row above back · centered step title · right action.
 * With `onBack` (confirm-before-leaving) the lockup is not a link, so it cannot bypass the confirmation.
 */
export function StepHeader({ title, backHref, onBack, right }: { title: string; backHref?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <header>
      <div className="flex h-12 items-center">
        <Brand href={onBack ? null : "/"} />
      </div>
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center">
        <div className="justify-self-start">
          <BackButton href={backHref} onClick={onBack} />
        </div>
        <h1 className="text-[20px] font-bold leading-7 tracking-[-0.4px]">{title}</h1>
        <div className="justify-self-end">{right}</div>
      </div>
    </header>
  );
}
