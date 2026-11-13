"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "./Icons";

/** DANSANG D-symbol lockup. SVG masters keep the mark sharp at every header size.
 * `href={null}` renders it unlinked during live sessions.
 */
const LOCKUP_RATIO = 1056 / 144;
export function Brand({ href = "/", tone = "black", height: h = 18 }: { href?: string | null; tone?: "black" | "white"; height?: number }) {
  const inner = (
    <span className="flex items-center py-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- static vector brand asset at a fixed size */}
      <img src={`/brand/lockup-${tone}.svg`} alt="DANSANG" width={Math.round(h * LOCKUP_RATIO)} height={h} style={{ height: h, width: "auto" }} draggable={false} />
    </span>
  );
  if (!href) return inner;
  return (
    <Link href={href} aria-label="DANSANG 홈" className="rounded-lg">
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

/**
 * Brand row shared by every screen below the landing page, so the back chevron and the lockup sit at
 * the same spot everywhere: back · lockup on the left, optional right slot. Step screens put their
 * sticky title row under it (present/QA scroll this 48px row away with `sticky -top-12`). The row is
 * inset by --page-gutter even where a screen narrows --gutter, so it does not shift on present/QA.
 */
function BrandRow({ backHref, onBack, right }: { backHref?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="mx-[calc(var(--page-gutter)-var(--gutter))] flex h-12 items-center justify-between">
      <div className="flex items-center gap-0.5">
        <BackButton href={backHref} onClick={onBack} />
        {/* With onBack (confirm-before-leaving) the lockup is not a link, so it cannot bypass the confirmation. */}
        <Brand href={onBack ? null : "/"} />
      </div>
      {right}
    </div>
  );
}

/** Top bar for list-style screens (02 설정, 07 목록): back · lockup, right slot. */
export function BrandHeader({ right, backHref }: { right?: React.ReactNode; backHref: string }) {
  return (
    <header>
      <BrandRow backHref={backHref} right={right} />
    </header>
  );
}

/** Step top bar (03–06): the shared brand row, then a centered step title with the right action. */
export function StepHeader({ title, backHref, onBack, right }: { title: string; backHref?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <header>
      <BrandRow backHref={backHref} onBack={onBack} />
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center">
        <span />
        <h1 className="text-[20px] font-bold leading-7 tracking-[-0.4px]">{title}</h1>
        <div className="justify-self-end">{right}</div>
      </div>
    </header>
  );
}
