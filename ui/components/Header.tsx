"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "./Icons";

/**
 * Approved BI lockup (black P symbol + PR·SIM wordmark) from assets/bi/lockup-black.png
 * (copied by ui/scripts/prepare-brand.py). Aspect ratio 3.229:1 is preserved; no color/effects.
 * Clear space ≥ 1/4 of the symbol width (≈8px at 32px height) is kept by the padding below.
 */
export const LOCKUP_RATIO = 310 / 96;
export function Brand({ href = "/ui", size = "md" }: { href?: string | null; size?: "sm" | "md" }) {
  const h = size === "md" ? 32 : 28;
  const inner = (
    <span className="flex items-center py-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static raster logo, fixed size */}
      <img src="/ui/brand/lockup-black.png" alt="PR·SIM" width={Math.round(h * LOCKUP_RATIO)} height={h} style={{ height: h, width: "auto" }} draggable={false} />
    </span>
  );
  if (!href) return inner;
  return (
    <Link href={href} aria-label="PR·SIM 홈" className="rounded-lg px-0.5">
      {inner}
    </Link>
  );
}

/** Gray pill used in headers (기록, 01 / 03, 1 / 4 …). */
export function HeaderPill({ href, onClick, children, label, outline }: { href?: string; onClick?: () => void; children: React.ReactNode; label?: string; outline?: boolean }) {
  const cls = `inline-flex h-11 min-w-11 items-center justify-center rounded-full px-4 text-[15px] font-semibold tabular ${
    outline ? "border border-ink/80 bg-canvas" : "bg-surface"
  }`;
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
export function BackButton({ href, onClick, label = "뒤로 가기" }: { href?: string; onClick?: () => void; label?: string }) {
  const router = useRouter();
  const cls = "-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface";
  if (onClick)
    return (
      <button type="button" aria-label={label} className={cls} onClick={onClick}>
        <ChevronLeft size={26} />
      </button>
    );
  if (href)
    return (
      <Link href={href} aria-label={label} className={cls}>
        <ChevronLeft size={26} />
      </Link>
    );
  return (
    <button type="button" aria-label={label} className={cls} onClick={() => router.back()}>
      <ChevronLeft size={26} />
    </button>
  );
}

/** Brand header: approved lockup left, optional back chevron before it, right slot. */
export function BrandHeader({ right, backHref }: { right?: React.ReactNode; backHref?: string }) {
  return (
    <header className="flex h-14 items-center justify-between">
      <div className="flex items-center gap-2">
        {backHref && <BackButton href={backHref} />}
        <Brand />
      </div>
      {right}
    </header>
  );
}

/**
 * Step header: brand row (approved lockup, top-left on every screen per DESIGN.md) above
 * back · centered step title · right action. On live screens (`onBack` = confirm-before-leaving)
 * the lockup is not a link, so it can't bypass the exit confirmation.
 */
export function StepHeader({ title, backHref, onBack, right }: { title: string; backHref?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <header>
      <div className="flex h-12 items-center">
        <Brand href={onBack ? null : "/ui"} />
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
