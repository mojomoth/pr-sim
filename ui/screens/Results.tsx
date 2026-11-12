"use client";
import { BottomBar, Button, TextLink } from "../components/Button";
import { HeaderPill, StepHeader } from "../components/Header";
import { Check } from "../components/Icons";
import { Screen } from "../components/Layout";
import { MOCK_RESULT, QUESTION_COUNT, questionCount } from "../lib/mock";
import { firstLine, useUiState } from "../lib/store";

/** Mock result for a past record: sub-scores shifted by the score gap, verdict by band. */
function resultFor(total: number): typeof MOCK_RESULT {
  const d = total - MOCK_RESULT.total;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return {
    ...MOCK_RESULT,
    total,
    verdict: total >= 80 ? "설득력 있는 발표였어요." : total >= 75 ? "핵심은 전달됐어요. 근거를 조금 더 보강해 보세요." : "흐름은 잡혔어요. 근거와 답변 구조를 다듬어 보세요.",
    scores: MOCK_RESULT.scores.map((sc, i) => ({ ...sc, value: clamp(sc.value + d + (i === 2 ? -Math.sign(d) : 0)) })),
  };
}

/** 05 · 종합 결과 — 총점 82, 영역별 점수, 강점·개선점, 상세 피드백 보기. */
export function Results() {
  const s = useUiState();
  const rec = s.viewRecord?.score !== undefined ? s.viewRecord : undefined;
  const r = rec ? resultFor(rec.score!) : MOCK_RESULT;
  const title = rec ? rec.title : firstLine(s.situation);
  const minutes = rec ? { p: rec.presentationMinutes, q: rec.qaMinutes } : { p: s.presentationMinutes, q: s.qaMinutes };
  return (
    <>
      <Screen width="wide" bottomPad={132}>
        <StepHeader title="종합 결과" backHref={rec ? "/ui/history" : "/ui/review"} right={<HeaderPill href="/ui/history">기록</HeaderPill>} />

        <div className="mt-6 text-center lg:mt-10">
          <h2 className="text-[28px] font-bold leading-9 tracking-[-0.8px] lg:text-[36px] lg:leading-[44px]">
            한 번 더,
            <br />
            더 좋은 발표로.
          </h2>
          <p className="mt-2 text-[16px] leading-6 text-secondary">
            {title}
            {rec && <span className="tabular"> · {rec.date} 기록</span>}
          </p>
        </div>

        <div className="mt-7 flex flex-col gap-3 lg:mx-auto lg:grid lg:w-full lg:max-w-[960px] lg:grid-cols-2 lg:gap-5">
          <div className="flex flex-col gap-3">
            <section className="relative rounded-[28px] bg-surface p-6" aria-label="종합 점수">
              <p className="text-[14px] font-medium text-secondary">이번 발표의 종합 점수</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-[80px] font-bold leading-[88px] tracking-[-4px] tabular" data-testid="total-score">
                  {r.total}
                </span>
                <span className="text-[22px] font-medium text-secondary tabular">/ 100</span>
              </p>
              <p className="mt-1 text-[16px] leading-6 text-secondary">{r.verdict}</p>
              <span className="ui-dot absolute right-6 top-6 h-3 w-3 rounded-full bg-ink" aria-hidden="true" />
            </section>
            <ul className="grid grid-cols-3 gap-2.5" aria-label="영역별 점수">
              {r.scores.map((sc) => (
                <li key={sc.label} className="flex flex-col items-center gap-0.5 rounded-[20px] bg-surface px-2 py-4">
                  <span className="text-[14px] font-medium text-secondary">{sc.label}</span>
                  <span className="text-[32px] font-bold leading-10 tracking-[-1px] tabular">{sc.value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <section className="rounded-[28px] bg-surface p-6" aria-labelledby="good-h">
              <h3 id="good-h" className="text-[20px] font-semibold leading-7 tracking-[-0.4px]">
                잘한 점
              </h3>
              <ul className="mt-3 flex flex-col gap-2.5">
                {r.strengths.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[16px] leading-6">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-inverse">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-[28px] bg-surface p-6" aria-labelledby="next-h">
              <h3 id="next-h" className="text-[20px] font-semibold leading-7 tracking-[-0.4px]">
                다음 연습에서는
              </h3>
              <ol className="mt-3 flex flex-col gap-2.5">
                {r.improvements.map((t, i) => (
                  <li key={t} className="flex gap-2.5 text-[16px] leading-6">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink text-[12px] font-bold tabular">{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </section>
            <p className="rounded-full bg-surface px-4 py-3 text-center text-[14px] text-secondary tabular">
              발표 {minutes.p}분 · 질의응답 {minutes.q}분 · 질문 {rec ? QUESTION_COUNT : questionCount(s.judges.length)}개
            </p>
            <p className="text-center text-[12px] text-secondary">점수와 조언은 시각 설계를 위한 예시 데이터예요.</p>
          </div>
        </div>
      </Screen>

      <BottomBar>
        <Button href="/ui/feedback" arrow>
          상세 피드백 보기
        </Button>
        <div className="flex justify-center">
          <TextLink href="/ui/history">기록으로 돌아가기</TextLink>
        </div>
      </BottomBar>
    </>
  );
}
