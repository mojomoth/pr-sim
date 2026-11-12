"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bubble, Caret } from "../components/Bubble";
import { BottomBar, Button } from "../components/Button";
import { PermissionNotice } from "../components/CameraView";
import { HeaderPill, StepHeader } from "../components/Header";
import { Mic, MicOff } from "../components/Icons";
import { JudgeAvatar, JudgeHero, personaText } from "../components/JudgeCard";
import { Screen } from "../components/Layout";
import { ExitDialog, PhaseEndDialog } from "../components/SessionDialogs";
import { Timer } from "../components/Timer";
import { Waveform } from "../components/Waveform";
import { buildQuestions, MOCK_RESULT, type MockQA } from "../lib/mock";
import { firstLine, getUiState, setUiState, todayDot, useUiState, type UiJudge } from "../lib/store";
import { useCountdown, useSecondsOverride } from "../lib/useCountdown";
import { useMicLevel } from "../lib/useMedia";
import { useMockStt } from "../lib/useMockStt";

/** One question → answer exchange; remounted per question (key) so mock STT restarts. */
function Exchange({ qa, total, micOn, onAsked }: { qa: MockQA; total: number; micOn: boolean; onAsked?: (asking: boolean) => void }) {
  const q = useMockStt([qa.question], true, { charMs: 38, holdMs: 400, gapMs: 1 });
  const asking = q.status === "listening";
  const a = useMockStt([qa.answer], !asking && micOn, { charMs: 70, holdMs: 99999 });
  useEffect(() => {
    onAsked?.(asking);
  }, [asking, onAsked]);
  const answerText = a.status === "listening" ? a.partial : a.finals[0] ?? "";
  const answerStatus = !micOn ? "마이크 꺼짐" : a.status === "listening" ? "음성 인식 중" : answerText ? "인식 완료" : "대기 중";
  return (
    <div className="flex flex-col gap-4">
      <Bubble label="심사위원 질문" status={<span className="tabular">{`${qa.index + 1} / ${total}`}</span>} live>
        <span className="text-[18px] font-semibold leading-[27px]">
          {asking ? q.partial : qa.question}
          {asking && <Caret />}
        </span>
      </Bubble>
      {!asking && (
        <Bubble tone="ink" label="내 답변" status={answerStatus} className="ui-enter">
          {answerText || <span className="text-inverse/60">답변을 말해 보세요…</span>}
          {a.status === "listening" && answerText && <Caret inverse />}
        </Bubble>
      )}
    </div>
  );
}

/** 04 · 심사 / 질의응답 — 남은 시간, 큰 심사위원 얼굴, 질문, 내 답변, 답변 완료. */
export function Review() {
  const s = useUiState();
  const router = useRouter();
  const override = useSecondsOverride();
  const total = override ?? s.qaMinutes * 60;
  const [ended, setEnded] = useState(false);
  const [exit, setExit] = useState<null | "end" | "back">(null);
  const finish = () => {
    setUiState({
      lastRun: { date: todayDot(), title: firstLine(s.situation), presentationMinutes: s.presentationMinutes, qaMinutes: s.qaMinutes, status: "done", score: MOCK_RESULT.total },
      resume: undefined,
      viewRecord: undefined,
    });
  };
  const resumeSec = s.resume?.phase === "review" && !override ? s.resume.remainingSec : undefined;
  // Entering 질의응답 consumes a paused 발표 resume point (idempotent → StrictMode-safe).
  useEffect(() => {
    if (getUiState().resume?.phase === "presentation") setUiState({ resume: undefined });
  }, []);
  const remaining = useCountdown(total, {
    initial: resumeSec,
    running: !ended && !exit,
    onEnd: () => {
      setEnded(true);
      finish();
    },
  });
  const [micOn, setMicOn] = useState(true);
  const mic = useMicLevel(micOn && !ended);

  const questions = useMemo(() => buildQuestions(s.judges), [s.judges]);
  const [idx, setIdx] = useState(0);
  const [asking, setAsking] = useState(true);
  const qa = questions[Math.min(idx, questions.length - 1)];
  const judge: UiJudge | undefined = qa && s.judges.find((j) => j.id === qa.judge.id);
  const last = idx >= questions.length - 1;

  const next = () => {
    if (last) {
      finish();
      router.push("/ui/results");
    } else {
      setIdx((i) => i + 1);
      setAsking(true);
    }
  };

  if (!qa || !judge) {
    return (
      <Screen>
        <StepHeader title="질의응답" backHref="/ui/setup" />
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="text-[20px] font-semibold">심사위원이 없어요</p>
          <p className="text-secondary">상황 설정에서 심사위원을 1명 이상 추가해 주세요.</p>
          <Button href="/ui/setup" size="md">
            상황 설정으로
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <>
      <Screen width="wide" bottomPad={84}>
        {/* DESIGN.md: 단계 이름과 남은 시간을 상단에 고정 */}
        <div className="sticky top-0 z-20 -mx-[var(--gutter)] bg-canvas px-[var(--gutter)] pb-3" data-testid="phase-bar">
          <StepHeader
            title="질의응답"
            onBack={() => setExit("back")}
            right={
              <HeaderPill onClick={() => setExit("end")}>
                종료
              </HeaderPill>
            }
          />
          <div className="mt-1 lg:mx-auto lg:w-[420px]">
            <Timer label={resumeSec ? "질의응답 남은 시간 · 이어하기" : "질의응답 남은 시간"} remaining={remaining} total={total} />
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-4 lg:mx-auto lg:grid lg:w-full lg:max-w-[1040px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
          <div className="flex flex-col gap-4">
            <div key={judge.id + idx} className="ui-fade">
              <JudgeHero judge={judge} speaking={asking} />
            </div>
            <ol className="hidden flex-wrap items-center gap-3 lg:flex" aria-label="질문 순서">
              {questions.map((q, i) => {
                const j = s.judges.find((x) => x.id === q.judge.id)!;
                return (
                  <li key={i} className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] ${i === idx ? "bg-ink text-inverse" : i < idx ? "text-secondary" : "bg-surface"}`} aria-current={i === idx ? "step" : undefined}>
                    <JudgeAvatar judge={j} size={28} secondary />
                    {personaText(q.judge)}
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="flex flex-col gap-4">
            <Exchange key={idx} qa={qa} total={questions.length} micOn={micOn} onAsked={setAsking} />
            <p className="text-center text-[14px] text-secondary">천천히, 핵심부터 답변해 보세요.</p>
            {micOn && (mic.status === "denied" || mic.status === "nodevice") && <PermissionNotice kind="마이크" onRetry={mic.retry} />}
            <div className="flex items-center gap-4 rounded-full bg-surface p-2 pr-6">
              <button
                type="button"
                onClick={() => setMicOn((v) => !v)}
                aria-pressed={micOn}
                aria-label={micOn ? "마이크 끄기" : "마이크 켜기"}
                className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${micOn ? "bg-card text-ink" : "bg-ink text-inverse"}`}
              >
                {micOn ? <Mic size={24} /> : <MicOff size={24} />}
              </button>
              <Waveform bars={26} level={micOn ? (mic.level ?? undefined) : 0} active={micOn && !asking} className="h-8 flex-1 justify-center text-secondary" />
              <span className="shrink-0 text-[13px] font-medium text-secondary">{micOn ? (asking ? "질문 듣는 중" : "듣고 있어요") : "마이크 꺼짐"}</span>
            </div>
          </div>
        </div>
      </Screen>

      <BottomBar wide line={false}>
        <div className="lg:mx-auto lg:w-full lg:max-w-[1040px] lg:pl-[calc(50%+20px)]">
          <Button onClick={next} arrow>
            {last ? "답변 완료 · 결과 보기" : "답변 완료"}
          </Button>
        </div>
      </BottomBar>

      <ExitDialog
        open={exit !== null}
        onClose={() => setExit(null)}
        phase="review"
        remainingSec={remaining}
        to={exit === "back" ? "/ui/setup" : "/ui/history"}
        title={exit === "back" ? "질의응답을 멈추고 나갈까요?" : undefined}
        confirmLabel={exit === "back" ? "나가기" : undefined}
      />
      <PhaseEndDialog
        open={ended}
        title="질의응답 시간이 끝났어요"
        body="답변을 정리해 종합 결과를 보여 드릴게요."
        nextLabel="결과 보기"
        href="/ui/results"
      />
    </>
  );
}
