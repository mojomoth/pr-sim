import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "../components/Icons";
import "./landing.css";

/** Full-viewport stage photography, with a separate mobile composition. */
export function Landing() {
  return (
    <div className="landing">
      <picture className="landing__backdrop" aria-hidden="true">
        <source media="(min-width: 1024px), (min-width: 600px) and (max-height: 600px) and (orientation: landscape)" srcSet="/landing/hero-stage-desktop-v2.webp" />
        {/* Native picture selects just one art-directed source before loading. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/landing/hero-stage-mobile-v2.webp" alt="" fetchPriority="high" decoding="async" />
      </picture>
      <div className="landing__veil" aria-hidden="true" />

      <header className="landing__header">
        <Link href="/ui" aria-label="PR·SIM 홈" className="landing__brand">
          <Image src="/landing/brand-lockup-white.webp" alt="PR·SIM" width={158} height={53} preload />
        </Link>
        <Link href="/ui/history" className="landing__history">
          연습 기록 <ArrowRight size={16} />
        </Link>
      </header>

      <main className="landing__main">
        <section className="landing__intro" aria-labelledby="landing-title">
          <p className="landing__eyebrow"><span aria-hidden="true" />발표 시뮬레이터</p>
          <h1 id="landing-title" className="landing__title">
            <span>실전처럼 연습하고,</span>
            <span>자신 있게</span>
            <span>발표하세요.</span>
          </h1>
          <p className="landing__description">
            AI 심사위원과 함께하는 발표 리허설.
            <span className="landing__description-extra"><br />다음 무대의 자신감은 여기서 시작됩니다.</span>
          </p>
        </section>

        <div className="landing__action">
          <Link href="/ui/setup" className="landing__start">
            <span>시작하기</span>
            <span className="landing__start-arrow" aria-hidden="true"><ArrowRight size={22} /></span>
          </Link>
          <p className="landing__action-note">상황 설정부터 피드백까지, 한 번에.</p>
        </div>
      </main>

      <footer className="landing__footer">
        <p className="landing__footer-label">다음 발표를 위한 리허설</p>
        <ol className="landing__steps" aria-label="연습 과정">
          <li><span>01</span>상황 설정</li>
          <li><span>02</span>발표 · 심사</li>
          <li><span>03</span>피드백</li>
        </ol>
      </footer>
    </div>
  );
}
