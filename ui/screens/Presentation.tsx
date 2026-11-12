"use client";
import { useState } from "react";
import { Bubble, Caret } from "../components/Bubble";
import { BottomBar, Button } from "../components/Button";
import { CameraView, PermissionNotice } from "../components/CameraView";
import { HeaderPill, StepHeader } from "../components/Header";
import { JudgeTile } from "../components/JudgeCard";
import { MediaToggle, Screen } from "../components/Layout";
import { ExitDialog, PhaseEndDialog } from "../components/SessionDialogs";
import { SlideStage, useDeck } from "../components/SlideStage";
import { Timer } from "../components/Timer";
import { Waveform } from "../components/Waveform";
import { MOCK_TRANSCRIPT } from "../lib/mock";
import { useUiState } from "../lib/store";
import { useCountdown, useSecondsOverride } from "../lib/useCountdown";
import { useCamera, useMicLevel } from "../lib/useMedia";
import { useMockStt } from "../lib/useMockStt";

/** 03 · 발표 — 남은 시간, PDF, 내 카메라, 전사 말풍선, 심사위원 얼굴 3개. */
export function Presentation() {
  const s = useUiState();
  const override = useSecondsOverride();
  const total = override ?? s.presentationMinutes * 60;
  const [ended, setEnded] = useState(false);
  // "end" = 종료 button, "back" = header back chevron. Both confirm and save the run as 진행 중.
  const [exit, setExit] = useState<null | "end" | "back">(null);
  const resumeSec = s.resume?.phase === "presentation" && !override ? s.resume.remainingSec : undefined;
  const remaining = useCountdown(total, { running: !ended && !exit, initial: resumeSec, onEnd: () => setEnded(true) });

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const cam = useCamera(camOn && !ended);
  const mic = useMicLevel(micOn && !ended);
  const stt = useMockStt(MOCK_TRANSCRIPT, micOn && !ended);

  const deck = useDeck();
  const [page, setPage] = useState(1);

  const judges = s.judges.slice(0, 6);
  const sttLabel = !micOn ? "마이크 꺼짐" : stt.status === "listening" ? "음성 인식 중" : stt.status === "final" ? "인식 완료" : "대기 중";
  const current = stt.status === "listening" ? stt.partial : stt.finals[stt.finals.length - 1] ?? "";
  const previous = stt.status === "listening" ? stt.finals.slice(-2) : stt.finals.slice(-3, -1);

  const transcript = (
    <section aria-labelledby="stt-h" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 id="stt-h" className="text-[17px] leading-6">
          <span className="font-bold">내 발표</span>
          <span className="text-secondary"> · {sttLabel}</span>
        </h2>
        <Waveform bars={14} level={micOn ? (mic.level ?? undefined) : 0} active={micOn && stt.status === "listening"} className="h-6 text-ink" />
      </div>
      {previous.length > 0 && (
        <ol className="flex flex-col gap-1 px-1 text-[14px] leading-5 text-secondary" aria-label="이전 문장">
          {previous.map((t, i) => (
            <li key={`${stt.finals.length}-${i}`} className="truncate">
              {t}
            </li>
          ))}
        </ol>
      )}
      <Bubble live>
        {current || <span className="text-secondary">말을 시작하면 문장별로 전사돼요.</span>}
        {stt.status === "listening" && current && <Caret />}
      </Bubble>
      <p className="px-1 text-[12px] text-secondary tabular">전사된 문장 {stt.finals.length}개 · 예시 전사</p>
    </section>
  );

  const judgeRow = (
    <section aria-label="심사위원" className="grid grid-cols-3 gap-3">
      {judges.slice(0, 3).map((j) => (
        <JudgeTile key={j.id} judge={j} />
      ))}
      {judges.length > 3 && <p className="col-span-3 text-[12px] text-secondary">외 {judges.length - 3}명 참석</p>}
    </section>
  );

  const notices = (
    <>
      {camOn && (cam.status === "denied" || cam.status === "nodevice") && <PermissionNotice kind="카메라" onRetry={cam.retry} />}
      {micOn && (mic.status === "denied" || mic.status === "nodevice") && <PermissionNotice kind="마이크" onRetry={mic.retry} />}
    </>
  );

  return (
    <>
      <Screen width="wide" bottomPad={140}>
        {/* DESIGN.md: 단계 이름과 남은 시간을 상단에 고정 */}
        <div className="sticky top-0 z-20 -mx-[var(--gutter)] bg-canvas px-[var(--gutter)] pb-3" data-testid="phase-bar">
          <StepHeader
            title="발표 중"
            onBack={() => setExit("back")}
            right={
              <HeaderPill outline onClick={() => setExit("end")}>
                종료
              </HeaderPill>
            }
          />
          <div className="mt-1 lg:mx-auto lg:w-[420px]">
            <Timer label={resumeSec ? "발표 남은 시간 · 이어하기" : "발표 남은 시간"} remaining={remaining} total={total} />
          </div>
        </div>

        {/* Slide height cap: the whole stage incl. prev/next + counter stays above the fixed bottom bar. */}
        <div className="mt-2 flex [--slide-max-h:min(360px,calc(100dvh-400px))] lg:[--slide-max-h:max(240px,calc(100dvh-360px))] flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <div className="relative flex flex-col gap-3">
            <SlideStage
              src={deck}
              page={page}
              onPage={setPage}
              overlay={
                <div className="pointer-events-none absolute bottom-[62px] right-5 sm:bottom-[66px] sm:right-6 lg:hidden">
                  <CameraView stream={cam.stream} status={cam.status} variant="inset" />
                </div>
              }
            />
            <div className="lg:hidden">{notices}</div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="hidden flex-col gap-3 lg:flex">
              <CameraView stream={cam.stream} status={cam.status} />
              {notices}
            </div>
            {transcript}
            {judgeRow}
          </div>
        </div>
      </Screen>

      <BottomBar wide>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex gap-2 lg:w-[360px]">
            <MediaToggle kind="mic" on={micOn} onToggle={() => setMicOn((v) => !v)} />
            <MediaToggle kind="camera" on={camOn} onToggle={() => setCamOn((v) => !v)} />
          </div>
          <Button href="/ui/review" arrow className="lg:flex-1">
            발표 마치기
          </Button>
        </div>
      </BottomBar>

      <ExitDialog
        open={exit !== null}
        onClose={() => setExit(null)}
        phase="presentation"
        remainingSec={remaining}
        to={exit === "back" ? "/ui/setup" : "/ui/history"}
        title={exit === "back" ? "발표를 멈추고 나갈까요?" : undefined}
        confirmLabel={exit === "back" ? "나가기" : undefined}
      />
      <PhaseEndDialog
        open={ended}
        title="발표 시간이 끝났어요"
        body="이제 질의응답 단계로 넘어갑니다. 심사위원이 순서대로 질문해요."
        nextLabel="질의응답 시작하기"
        href="/ui/review"
      />
    </>
  );
}
