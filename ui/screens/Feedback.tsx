"use client";
import { useState } from "react";
import { TEMPERAMENT_LABEL } from "@/lib/types";
import { BottomBar, Button, TextLink } from "../components/Button";
import { HeaderPill, StepHeader } from "../components/Header";
import { ArrowRight, ChevronLeft } from "../components/Icons";
import { JudgeAvatar } from "../components/JudgeCard";
import { Screen } from "../components/Layout";
import { MOCK_ANALYSIS, MOCK_FEEDBACK } from "../lib/mock";
import { useUiState } from "../lib/store";

type Tab = "qa" | "analysis";

/** 06 · 상세 피드백 — 질문별 근거·답변 개선 예시, 같은 조건으로 다시 연습. */
export function Feedback() {
  const s = useUiState();
  const [tab, setTab] = useState<Tab>("qa");
  const [i, setI] = useState(0);
  const f = MOCK_FEEDBACK[i];
  const total = MOCK_FEEDBACK.length;
  const judge = s.judges.find((j) => j.id === f.judgeId) ?? { name: f.judgeName, imageUrl: `/ui/judge-${f.judgeId}.jpg` };
  const headline = tab === "qa" ? f.headline : MOCK_ANALYSIS.headline;

  const tabs: { id: Tab; label: string }[] = [
    { id: "qa", label: "질문별 피드백" },
    { id: "analysis", label: "발표 분석" },
  ];

  return (
    <>
      <Screen bottomPad={132}>
        <StepHeader
          title="상세 피드백"
          backHref="/ui/results"
          right={tab === "qa" ? <HeaderPill label={`질문 ${i + 1} / ${total}`}>{`${i + 1} / ${total}`}</HeaderPill> : undefined}
        />

        <h2 className="mt-5 whitespace-pre-line text-[28px] font-bold leading-9 tracking-[-0.8px]">{headline}</h2>

        <div role="tablist" aria-label="피드백 종류" className="mt-6 grid grid-cols-2 rounded-full bg-surface p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  const n = tab === "qa" ? "analysis" : "qa";
                  setTab(n);
                  document.getElementById(`tab-${n}`)?.focus();
                }
              }}
              className={`h-12 rounded-full text-[16px] font-semibold transition-colors duration-200 ${tab === t.id ? "bg-ink text-inverse" : "text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "qa" ? (
          <section id="panel-qa" role="tabpanel" aria-labelledby="tab-qa" key={i} className="ui-enter mt-5 flex flex-col">
            <article className="flex gap-4 rounded-[28px] bg-surface p-5">
              <JudgeAvatar judge={judge} size={76} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex h-7 items-center rounded-full bg-canvas px-3 text-[13px] font-semibold">
                    {f.judgeName} · {TEMPERAMENT_LABEL[f.temperament]}
                  </span>
                  <span className="text-[13px] text-secondary tabular">질문 {String(i + 1).padStart(2, "0")}</span>
                </div>
                <p className="mt-2.5 whitespace-pre-line text-[17px] font-semibold leading-[25px] tracking-[-0.3px]">{f.question}</p>
              </div>
            </article>

            <div className="mt-6 px-1">
              <p className="text-[14px] text-secondary">내 답변</p>
              <p className="mt-1.5 whitespace-pre-line text-[17px] font-medium leading-[26px]">{f.answer}</p>
            </div>
            <hr className="mx-1 my-5 border-line" />
            <div className="px-1">
              <div className="flex items-center justify-between">
                <p className="text-[14px] text-secondary">심사위원 피드백</p>
                <span className="inline-flex h-8 items-center rounded-full bg-surface px-3 text-[15px] font-bold tabular">{f.score}점</span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-[17px] font-medium leading-[26px]">{f.feedback}</p>
            </div>

            <div className="mt-6 rounded-[28px] bg-surface p-6">
              <p className="text-[14px] text-secondary">이렇게 답해 보세요</p>
              <p className="mt-2 whitespace-pre-line text-[18px] font-semibold leading-[28px] tracking-[-0.3px]">{f.suggestion}</p>
            </div>

            <nav className="mt-4 flex items-center justify-between" aria-label="질문 이동">
              <button type="button" onClick={() => setI((v) => v - 1)} disabled={i === 0} className="inline-flex h-11 items-center gap-1 rounded-full px-3 text-[15px] font-semibold disabled:invisible">
                <ChevronLeft size={18} /> 이전 질문
              </button>
              <button type="button" onClick={() => setI((v) => v + 1)} disabled={i >= total - 1} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[16px] font-semibold disabled:text-secondary">
                {i >= total - 1 ? "마지막 질문이에요" : "다음 질문 보기"} {i < total - 1 && <ArrowRight size={18} />}
              </button>
            </nav>
          </section>
        ) : (
          <section id="panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" className="ui-enter mt-5 flex flex-col gap-3">
            <ul className="grid grid-cols-2 gap-2.5">
              {MOCK_ANALYSIS.metrics.map((m) => (
                <li key={m.label} className="flex flex-col rounded-[20px] bg-surface p-4">
                  <span className="text-[13px] font-medium text-secondary">{m.label}</span>
                  <span className="mt-1 flex items-baseline gap-1">
                    <span className="text-[28px] font-bold leading-9 tracking-[-0.8px] tabular">{m.value}</span>
                    <span className="text-[13px] text-secondary tabular">{m.unit}</span>
                  </span>
                  <span className="mt-1 text-[12px] leading-[18px] text-secondary">{m.note}</span>
                </li>
              ))}
            </ul>
            <figure className="rounded-[28px] bg-surface p-5">
              <figcaption className="flex items-baseline justify-between">
                <span className="text-[16px] font-semibold">말하기 흐름</span>
                <span className="text-[12px] text-secondary">30초 단위 발화량</span>
              </figcaption>
              <div className="mt-4 flex h-24 items-end gap-1.5" role="img" aria-label="발표 중반에 발화량이 가장 많고 마지막 1분에 줄어들었어요">
                {MOCK_ANALYSIS.pace.map((v, k) => (
                  <span key={k} className={`flex-1 rounded-t-[6px] ${v < 50 ? "bg-secondary/50" : "bg-ink"}`} style={{ height: `${v}%` }} />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[12px] text-secondary tabular">
                <span>0:00</span>
                <span>2:30</span>
                <span>5:00</span>
              </div>
            </figure>
            <section className="rounded-[28px] bg-surface p-6">
              <h3 className="text-[20px] font-semibold leading-7 tracking-[-0.4px]">구간별 메모</h3>
              <ol className="mt-3 flex flex-col gap-2.5">
                {MOCK_ANALYSIS.notes.map((t, k) => (
                  <li key={t} className="flex gap-2.5 text-[16px] leading-6">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink text-[12px] font-bold tabular">{k + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </section>
          </section>
        )}
      </Screen>

      <BottomBar>
        <Button href="/ui/setup" arrow>
          같은 조건으로 다시 연습
        </Button>
        <div className="flex justify-center">
          <TextLink href="/ui/history">기록으로 돌아가기</TextLink>
        </div>
      </BottomBar>
    </>
  );
}
