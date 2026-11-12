"use client";
// 05 · 종합 결과
import { BottomBar, Button, TextLink } from "@/components/Button";
import { HeaderPill, StepHeader } from "@/components/Header";
import { Check } from "@/components/Icons";
import { Card, Screen } from "@/components/Layout";
import { ScoreTiles, TotalScore } from "@/components/Score";
import type { Report, SessionRecord } from "@/features/session/types";
import { SUBSCORE_LABEL, type SubScores } from "@/server/report/types";
import { CiteProvider, CiteText } from "./cite";
import { LiteNotice, ProviderNote } from "./notes";

/** First sentence of the situation, as the subtitle under the headline. */
function situationTitle(s: string): string {
  const first = s.split(/(?<=[.。!?])\s|\n/)[0]?.trim() ?? "";
  return first || s.trim();
}

export function Summary({ session, report }: { session: SessionRecord; report: Report }) {
  const o = report.overall;
  const tiles = (Object.keys(SUBSCORE_LABEL) as (keyof SubScores)[]).flatMap((k) => (o.sub[k] == null ? [] : [{ label: SUBSCORE_LABEL[k], value: o.sub[k] }]));
  const summary = report.speech.analysis?.summary;
  return (
    <CiteProvider session={session}>
      <Screen bottomPad={136} className="break-keep [overflow-wrap:anywhere]">
        <StepHeader title="종합 결과" backHref="/history" right={<HeaderPill href="/history">기록</HeaderPill>} />

        <div className="mt-6 text-center">
          <h2 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">
            한 번 더,
            <br />더 좋은 발표로.
          </h2>
          <p className="mx-auto mt-2 line-clamp-2 max-w-[30ch] text-[16px] leading-6 text-secondary">{situationTitle(session.setup.situation)}</p>
        </div>

        <div className="mt-7 flex flex-col gap-3">
          <TotalScore score={o.total} verdict={o.oneLiner} />
          {!!o.excluded?.length && (
            <p className="rounded-[16px] bg-surface px-4 py-3 text-[14px] leading-[21px] text-secondary">
              {o.excluded.map((x) => `${SUBSCORE_LABEL[x.key]}(${x.reason})`).join(", ")} 항목은 총점에서 뺐어요. 나머지 항목만으로 계산했어요.
            </p>
          )}
          <LiteNotice report={report} />
          <ScoreTiles items={tiles} />

          {summary && (
            <Card title="발표 총평">
              <p className="text-[16px] leading-[25px]">
                <CiteText text={summary} />
              </p>
            </Card>
          )}

          {o.strengths.length > 0 && (
            <Card title="잘한 점">
              <ul className="flex flex-col gap-2.5">
                {o.strengths.map((t, i) => (
                  <li key={i} className="flex gap-2.5 text-[16px] leading-6">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-inverse" aria-hidden="true">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    <span>
                      <CiteText text={t} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {o.priorities.length > 0 && (
            <Card title="다음 연습에서는">
              <ol className="flex flex-col gap-3">
                {o.priorities.map((p, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink text-[12px] font-bold tabular" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold leading-6">{p.title}</p>
                      <p className="mt-0.5 text-[15px] leading-[22px] text-secondary">
                        <CiteText text={p.how} />
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <p className="rounded-full bg-surface px-4 py-3 text-center text-[14px] text-secondary tabular">
            발표 {report.meta.presentationMinutes}분 · 질의응답 {report.meta.qaMinutes}분 · 질문 {report.meta.questions}개
          </p>
          <ProviderNote report={report} />
        </div>
      </Screen>

      <BottomBar>
        <Button href={`/result?s=${encodeURIComponent(session.id)}&tab=feedback`} arrow>
          상세 피드백 보기
        </Button>
        <div className="flex justify-center">
          <TextLink href="/history">기록으로 돌아가기</TextLink>
        </div>
      </BottomBar>
    </CiteProvider>
  );
}
