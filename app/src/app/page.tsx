import Link from "next/link";
import { Brand } from "@/components/Header";
import { ArrowRight } from "@/components/Icons";

/** 01 · 랜딩 — full-bleed stage photo, title, 시작하기 → /setup, 연습 기록 → /history. */
export default function Landing() {
  return (
    <div className="app-bleed relative isolate flex min-h-full flex-1 flex-col bg-stage text-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- art-directed full-bleed backdrop, one static webp */}
      <img
        src="/landing/hero-stage-mobile-v2.webp"
        alt=""
        aria-hidden="true"
        fetchPriority="high"
        decoding="async"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover object-[center_60%]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-stage-scrim"
      />

      <header className="flex items-center justify-between gap-4 px-[var(--gutter)] pt-[max(14px,var(--safe-top))]">
        <Brand tone="white" href={null} height={39} />
        <Link
          href="/history"
          className="inline-flex min-h-11 items-center gap-2.5 rounded-full bg-white px-4 text-[14px] font-semibold text-ink shadow-[0_0_0_3px_rgb(0_0_0/55%),0_4px_16px_rgb(0_0_0/25%)] transition-colors hover:bg-card focus-visible:outline-white"
        >
          연습 기록 <ArrowRight size={16} />
        </Link>
      </header>

      <main className="flex flex-1 flex-col px-[var(--gutter)] pt-[38px]">
        <section className="text-center" aria-labelledby="landing-title">
          <p className="flex items-center justify-center gap-2 text-[13px] font-semibold">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            발표 시뮬레이터
          </p>
          <h1 id="landing-title" className="mt-4 text-[34px] font-bold leading-[1.16] tracking-[-0.06em]">
            <span className="block">실전처럼 연습하고,</span>
            <span className="block">자신 있게</span>
            <span className="block">발표하세요.</span>
          </h1>
          <p className="mt-4 text-[14px] leading-[1.7] tracking-[-0.035em] text-stage-muted">
            AI 심사위원과 함께하는 발표 리허설.
            <br />
            다음 무대의 자신감은 여기서 시작됩니다.
          </p>
        </section>

        <div className="mx-auto mt-auto w-full max-w-[420px] pb-[max(24px,var(--safe-bottom))] pt-48">
          <Link
            href="/setup"
            className="group flex min-h-16 items-center justify-between gap-6 rounded-[20px] bg-white py-2.5 pl-[26px] pr-[15px] text-[17px] font-semibold text-ink shadow-[0_0_0_5px_rgb(0_0_0/45%),0_12px_32px_rgb(0_0_0/35%)] transition-[background,transform] duration-200 hover:-translate-y-0.5 hover:bg-card focus-visible:outline-white focus-visible:outline-offset-[6px] active:translate-y-0"
          >
            시작하기
            <span aria-hidden="true" className="grid h-[38px] w-[38px] place-items-center rounded-full bg-ink text-white transition-transform duration-200 group-hover:-rotate-[35deg]">
              <ArrowRight size={22} />
            </span>
          </Link>
          <p className="mt-[14px] text-center text-[12px] text-stage-muted">상황 설정부터 피드백까지, 한 번에.</p>
        </div>
      </main>
    </div>
  );
}
