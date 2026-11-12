"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomBar, Button } from "../components/Button";
import { Badge, ChipGroup } from "../components/Chip";
import { BrandHeader } from "../components/Header";
import { Plus, User } from "../components/Icons";
import { Screen } from "../components/Layout";
import { MOCK_HISTORY, type HistoryRecord } from "../lib/mock";
import { resetSetup, setUiState, useUiState } from "../lib/store";
import { mmss } from "../lib/useCountdown";

type Filter = "all" | "done" | "in_progress";

/** 07 · 목록 — 기록 리스트, 결과 보기·다시 시작하기, 새 시뮬레이션. */
export function History() {
  const s = useUiState();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  const records: HistoryRecord[] = s.lastRun ? [{ id: "current", ...s.lastRun }, ...MOCK_HISTORY] : MOCK_HISTORY;
  const scored = records.filter((r) => r.status === "done" && r.score !== undefined);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length) : 0;
  const shown = filter === "all" ? records : records.filter((r) => r.status === filter);

  const restart = (r: HistoryRecord) => {
    // 다시 시작 → 상황 설정 (같은 상황·시간으로 채움)
    setUiState((p) => ({
      situation: r.id === "current" ? p.situation : r.title,
      presentationMinutes: r.presentationMinutes,
      qaMinutes: r.qaMinutes,
    }));
    router.push("/ui/setup");
  };

  // 이어하기 → the record's own setup + the phase/remaining time it was paused at.
  const resume = (r: HistoryRecord) => {
    const phase = r.phase ?? "presentation";
    const minutes = phase === "presentation" ? r.presentationMinutes : r.qaMinutes;
    setUiState((p) => ({
      situation: r.id === "current" ? p.situation : r.title,
      presentationMinutes: r.presentationMinutes,
      qaMinutes: r.qaMinutes,
      resume: { phase, remainingSec: Math.min(minutes * 60, r.remainingSec ?? minutes * 60) },
      viewRecord: undefined,
    }));
    router.push(phase === "presentation" ? "/ui/presentation" : "/ui/review");
  };

  // 결과 보기 → results for this record (score/title/minutes), not the latest run.
  const view = (r: HistoryRecord) => {
    setUiState({ viewRecord: r });
    router.push("/ui/results");
  };

  return (
    <>
      <Screen width="wide" bottomPad={84}>
        <BrandHeader
          right={
            <button type="button" aria-label="프로필" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface">
              <User size={22} />
            </button>
          }
        />

        <div className="lg:mt-6 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-12">
          <div className="lg:sticky lg:top-6 lg:self-start">
            <h1 className="mt-6 text-[28px] font-bold leading-9 tracking-[-0.8px] lg:mt-0">
              쌓이는 연습,
              <br />
              달라지는 발표.
            </h1>
            <p className="mt-1.5 text-[16px] text-secondary">나의 시뮬레이션 기록</p>
            <dl className="mt-6 grid grid-cols-2 gap-2.5">
              <div className="flex items-baseline justify-center gap-1.5 rounded-[20px] bg-surface py-4">
                <dt className="text-[15px] text-secondary">총</dt>
                <dd className="text-[28px] font-bold leading-9 tracking-[-0.8px] tabular">
                  {records.length}
                  <span className="ml-1 text-[15px] font-medium">회</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-center gap-1.5 rounded-[20px] bg-surface py-4">
                <dt className="text-[15px] text-secondary">평균</dt>
                <dd className="text-[28px] font-bold leading-9 tracking-[-0.8px] tabular">
                  {avg}
                  <span className="ml-1 text-[15px] font-medium">점</span>
                </dd>
              </div>
            </dl>
            <ChipGroup
              className="mt-6"
              label="기록 필터"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "전체" },
                { value: "done", label: "완료" },
                { value: "in_progress", label: "진행 중" },
              ]}
            />
          </div>

          <ul className="mt-6 flex flex-col gap-3 lg:mt-0" aria-label="시뮬레이션 기록" data-testid="history-list">
            {shown.length === 0 && <li className="rounded-[28px] border border-dashed border-line p-8 text-center text-secondary">해당하는 기록이 없어요.</li>}
            {shown.map((r) => (
              <li key={r.id} className="ui-enter rounded-[28px] bg-surface p-5">
                <div className="flex items-center gap-2.5">
                  <span className="text-[14px] text-secondary tabular">{r.date}</span>
                  {r.status === "done" ? <Badge>완료</Badge> : <Badge tone="muted">진행 중</Badge>}
                  {r.id === "current" && <span className="text-[12px] font-semibold">· 방금</span>}
                </div>
                <div className="mt-2 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[20px] font-semibold leading-7 tracking-[-0.4px]">{r.title}</p>
                    <p className="mt-0.5 text-[14px] text-secondary tabular">
                      발표 {r.presentationMinutes}분 · 질의응답 {r.qaMinutes}분
                    </p>
                  </div>
                  {r.score !== undefined && (
                    <p className="shrink-0 border-l border-line pl-4 tabular" aria-label={`${r.score}점`}>
                      <span className="text-[36px] font-bold leading-10 tracking-[-1.2px]">{r.score}</span>
                      <span className="text-[16px] font-semibold">점</span>
                    </p>
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  {r.status === "done" ? (
                    <>
                      <Button onClick={() => view(r)} size="md" arrow className="flex-1 rounded-[14px]" aria-label={`${r.title} 결과 보기`}>
                        결과 보기
                      </Button>
                      <Button onClick={() => restart(r)} size="md" variant="outline" className="rounded-[14px] px-4">
                        다시 시작하기
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => resume(r)} size="md" arrow className="flex-1 rounded-[14px]" aria-label={`${r.title} 이어하기`}>
                        이어하기
                      </Button>
                      {r.remainingSec !== undefined && (
                        <span className="self-center px-1 text-[13px] text-secondary tabular">
                          {r.phase === "review" ? "질의응답" : "발표"} {mmss(r.remainingSec)} 남음
                        </span>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Screen>

      <BottomBar wide line={false}>
        <div className="lg:ml-auto lg:w-[calc(100%-368px)]">
          <Button
            onClick={() => {
              resetSetup();
              router.push("/ui/setup");
            }}
          >
            <Plus size={20} /> 새 시뮬레이션
          </Button>
        </div>
      </BottomBar>
    </>
  );
}
