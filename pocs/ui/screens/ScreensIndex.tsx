import Image from "next/image";
import Link from "next/link";
import { BrandHeader, HeaderPill } from "../components/Header";
import { ArrowRight } from "../components/Icons";

export const SCREENS = [
  { n: "01", name: "랜딩", href: "/ui", draft: "01-landing", desc: "타이틀 · 흑백 발표장 사진 · 시작하기" },
  { n: "02", name: "상황 설정", href: "/ui/setup", draft: "02-setup", desc: "상황 · 시간 슬라이더 2개 · PDF 업로드 2개 · 심사위원 추가/삭제/성향" },
  { n: "03", name: "발표", href: "/ui/presentation", draft: "03-presentation", desc: "남은 시간 · PDF 슬라이드 · 내 카메라 · 전사 말풍선 · 심사위원 3명" },
  { n: "04", name: "심사 / 질의응답", href: "/ui/review", draft: "04-review", desc: "남은 시간 · 큰 심사위원 얼굴 · 질문 · 내 답변 · 답변 완료" },
  { n: "05", name: "종합 결과", href: "/ui/results", draft: "05-results", desc: "총점 82 · 영역별 점수 · 잘한 점 · 다음 연습에서는" },
  { n: "06", name: "상세 피드백", href: "/ui/feedback", draft: "06-feedback", desc: "질문별 피드백 / 발표 분석 탭 · 1/4 · 이렇게 답해 보세요" },
  { n: "07", name: "목록", href: "/ui/history", draft: "07-history", desc: "필터 · 기록 카드 · 결과 보기 / 다시 시작하기 · 새 시뮬레이션" },
] as const;

/** Reviewer index: every screen with its draft thumbnail (docs/screens/draft). */
export function ScreensIndex() {
  return (
    <div className="ui-enter mx-auto flex w-full max-w-[1120px] flex-col px-[var(--gutter)] pb-16">
      <BrandHeader right={<HeaderPill href="/">PoC 허브</HeaderPill>} />
      <h1 className="mt-6 text-[28px] font-bold leading-9 tracking-[-0.8px]">UI PoC · 화면 7종</h1>
      <p className="mt-2 max-w-[640px] text-[16px] leading-6 text-secondary">
        왼쪽 썸네일은 시안(docs/screens/draft), 링크는 구현 화면이에요. 모든 데이터는 예시이며 AI 호출은 없어요. 흐름: 랜딩 → 설정 → 발표 → 심사 → 결과 → 피드백 → 목록.
      </p>
      <p className="mt-2 max-w-[640px] text-[14px] leading-5 text-secondary">
        모든 화면 왼쪽 위에 확정 BI 로고(assets/bi/lockup-black.png)를 쓰고, 심사위원·카메라·슬라이드는 컬러로 보여 줘요(DESIGN.md 색상 범위). 썸네일은 확정 BI로 다시 렌더된 시안이며, 시안이 바뀌면 ui/scripts/sync-drafts.sh로 갱신해요.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/ui" className="inline-flex h-12 items-center gap-2 rounded-[16px] bg-ink px-5 font-semibold text-inverse">
          처음부터 흐름 따라가기 <ArrowRight size={18} />
        </Link>
        <Link href="/ui/presentation?sec=12" className="inline-flex h-12 items-center rounded-[16px] bg-surface px-5 font-semibold">
          발표 12초 버전 (자동 전환 확인)
        </Link>
        <Link href="/ui/review?sec=40" className="inline-flex h-12 items-center rounded-[16px] bg-surface px-5 font-semibold">
          질의응답 40초 버전
        </Link>
      </div>

      <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SCREENS.map((s) => (
          <li key={s.n}>
            <Link href={s.href} className="group flex h-full gap-4 rounded-[28px] bg-surface p-4 transition-colors hover:bg-card">
              <div className="relative h-[168px] w-[68px] shrink-0 overflow-hidden rounded-[12px] bg-canvas">
                <Image src={`/ui/drafts/${s.draft}.jpg`} alt={`${s.name} 시안 썸네일`} fill sizes="68px" className="object-cover object-top" />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-[12px] font-semibold text-secondary tabular">{s.n}</span>
                <span className="text-[20px] font-semibold leading-7 tracking-[-0.4px]">{s.name}</span>
                <span className="mt-1 text-[14px] leading-5 text-secondary">{s.desc}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[14px] font-semibold tabular">
                  {s.href} <ArrowRight size={16} />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
