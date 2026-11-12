import Link from "next/link";
import { ArrowRight } from "./Icons";

type Variant = "primary" | "secondary" | "outline";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold text-[16px] leading-6 tracking-[-0.2px] select-none transition-[opacity,transform] duration-200 active:scale-[0.99] disabled:cursor-not-allowed";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-inverse hover:opacity-90 disabled:bg-card disabled:text-secondary disabled:hover:opacity-100",
  secondary: "bg-surface text-ink hover:bg-card disabled:text-secondary",
  outline: "bg-transparent text-ink border border-ink/70 hover:bg-surface",
};
const sizes = {
  lg: "h-14 rounded-[20px] px-6 w-full",
  md: "h-12 rounded-[16px] px-5",
  sm: "h-11 rounded-full px-4 text-[15px]",
};

interface Props {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: Variant;
  size?: keyof typeof sizes;
  arrow?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/** Main CTA: black surface / white text, 56px tall, radius 20 (DESIGN.md). `href` renders a Link. */
export function Button({ children, href, onClick, variant = "primary", size = "lg", arrow, disabled, className = "", type = "button", ...aria }: Props) {
  const cls = `${base} ${variants[variant]} ${sizes[size]} ${className}`;
  const content = (
    <>
      {children}
      {arrow && <ArrowRight size={20} />}
    </>
  );
  if (href && !disabled)
    return (
      <Link href={href} className={cls} onClick={onClick} {...aria}>
        {content}
      </Link>
    );
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} {...aria}>
      {content}
    </button>
  );
}

/** Underlined secondary text link (e.g. 기록으로 돌아가기). */
export function TextLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="inline-flex min-h-11 items-center justify-center px-2 text-[15px] text-secondary underline underline-offset-4 hover:text-ink">
      {children}
    </Link>
  );
}

/**
 * Fixed bottom action bar. Sticks to the bottom of the phone screen in both device modes and adds the
 * bottom safe area (`app-bottom-bar`, globals.css). Reserve its height with <Screen bottomPad={…}/>:
 * one 56px button ≈ 72, button + TextLink ≈ 124.
 */
export function BottomBar({ children, line = true }: { children: React.ReactNode; line?: boolean }) {
  return (
    <div className={`app-bottom-bar bg-canvas ${line ? "border-t border-line" : ""}`}>
      <div className="flex w-full flex-col gap-2 px-[var(--gutter)] pt-3">{children}</div>
    </div>
  );
}
