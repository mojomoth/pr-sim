"use client";
// 03 · 발표 — remaining time, PDF slides with my camera, live transcript, the judges.
// The transcript is saved sentence by sentence and the remaining time every few seconds, so a reload
// or 기록 → 이어하기 resumes where the presenter left off.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bubble } from "@/components/Bubble";
import { BottomBar, Button } from "@/components/Button";
import { CameraView } from "@/components/CameraView";
import { ConfirmDialog, PhaseEndDialog } from "@/components/Dialog";
import { HeaderPill, StepHeader } from "@/components/Header";
import { MediaToggle, Screen } from "@/components/Layout";
import { Timer } from "@/components/Timer";
import { Waveform } from "@/components/Waveform";
import { getBlob, updateSession } from "@/features/session/db";
import type { SessionRecord, TranscriptSentence } from "@/features/session/types";
import { useCountdown, useSecondsOverride } from "@/features/session/useCountdown";
import { SlideViewer } from "@/features/slide/SlideViewer";
import { useSentenceTranscriber } from "@/features/stt/useSentenceTranscriber";
import { platform, useCamera } from "@/platform";
import { cameraViewStatus, LoadingScreen, MediaProblem, micStatusFromError, MissingSession, SessionJudgeTile, useSessionFromQuery } from "./shared";

export function PresentScreen() {
  const s = useSessionFromQuery();
  const router = useRouter();
  const status = s.state === "ready" ? s.rec.status : undefined;
  const done = status !== undefined && status !== "setup" && status !== "presentation";
  useEffect(() => {
    // Presentation already over (back button, old link): go to the step the session is in.
    if (done) router.replace(status === "qa" ? `/qa?s=${s.id}` : `/result?s=${s.id}`);
  }, [done, status, s.id, router]);
  if (s.state === "loading" || done) return <LoadingScreen />;
  if (s.state === "missing") return <MissingSession />;
  return <Presentation key={s.rec.id} rec={s.rec} />;
}

type Stage = "ready" | "live" | "ended";

function Presentation({ rec }: { rec: SessionRecord }) {
  const router = useRouter();
  const id = rec.id;
  const override = useSecondsOverride();
  const total = override ?? rec.setup.presentationMinutes * 60;
  const resumeSec = !override && rec.resume?.phase === "presentation" ? rec.resume.remainingSec : undefined;

  const [stage, setStage] = useState<Stage>("ready");
  const [confirm, setConfirm] = useState<null | "exit" | "back" | "finish">(null);
  const [timeUp, setTimeUp] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── slides ──
  const [deck, setDeck] = useState<Blob | null | undefined>(undefined);
  const pdfKey = rec.docs.presentation?.pdfKey;
  useEffect(() => {
    let cancelled = false;
    (pdfKey ? getBlob(pdfKey) : Promise.resolve(undefined))
      .then((b) => !cancelled && setDeck(b ?? null))
      .catch(() => !cancelled && setDeck(null));
    return () => {
      cancelled = true;
    };
  }, [pdfKey]);
  const lastSlide = [...rec.transcript].reverse().find((x) => x.phase === "presentation" && x.slide)?.slide ?? 1;
  const pageRef = useRef(lastSlide);

  // ── media ──
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const cam = useCamera(camOn && stage !== "ended");

  const persistSentence = useCallback(
    (x: TranscriptSentence) => {
      updateSession(id, (cur) => ({ ...cur, transcript: [...cur.transcript, x] })).catch(() => setSaveError("전사 내용을 저장하지 못했어요. 저장 공간을 확인해 주세요."));
    },
    [id],
  );
  const stt = useSentenceTranscriber({ phase: "presentation", getSlide: () => pageRef.current, onSentence: persistSentence });

  // ── time ──
  const finishRef = useRef<() => void>(() => {});
  const remaining = useCountdown(total, { running: stage === "live" && !confirm, initial: resumeSec, onEnd: () => finishRef.current() });
  const remRef = useRef(remaining);
  useEffect(() => {
    remRef.current = remaining;
  }, [remaining]);
  const elapsed = () => Math.max(0, total - remRef.current);

  const saveResume = useCallback(
    () => updateSession(id, { status: "presentation", resume: { phase: "presentation", remainingSec: Math.max(1, Math.ceil(remRef.current)) } }),
    [id],
  );
  // Save the remaining time every 5 s and when the tab is hidden (reload, app switch).
  useEffect(() => {
    if (stage !== "live") return;
    const save = () => void saveResume().catch(() => {});
    const t = window.setInterval(save, 5000);
    const onHide = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [stage, saveResume]);

  const begin = () => {
    platform.audio.unlock(); // inside the tap, so judge voices can play later on iOS
    setStage("live");
    void saveResume().catch(() => setSaveError("기록을 저장하지 못했어요. 저장 공간을 확인해 주세요."));
    if (micOn) void stt.start(elapsed());
  };

  const toggleMic = () => {
    if (micOn) {
      setMicOn(false);
      void stt.stop();
    } else {
      setMicOn(true);
      if (stage === "live") void stt.start(elapsed());
    }
  };

  /** End the presentation (time up or 발표 마치기): keep the last words, then hand over to Q&A. */
  const finish = async () => {
    setStage("ended");
    await stt.stop();
    await updateSession(id, { status: "qa", resume: undefined }).catch(() => {});
  };
  useEffect(() => {
    finishRef.current = () => {
      setTimeUp(true);
      void finish();
    };
  });

  const leave = async (to: string) => {
    setConfirm(null);
    if (stage === "live") {
      setStage("ended");
      await stt.stop();
      await saveResume().catch(() => {});
    }
    router.push(to);
  };

  // ── transcript bubble ──
  const listening = stt.status === "listening";
  const partial = stt.partialSentences.at(-1);
  const lastFinal = stt.sentences.at(-1)?.text ?? [...rec.transcript].reverse().find((x) => x.phase === "presentation")?.text;
  const bubbleText = partial ?? lastFinal;
  const sttState =
    stage === "ready"
      ? "시작 전"
      : !micOn
        ? "마이크 꺼짐"
        : stt.status === "connecting"
          ? "연결 중"
          : listening
            ? "음성 인식 중"
            : stt.status === "error"
              ? "멈춤"
              : "대기 중";

  const judges = rec.judges.slice(0, 3);

  return (
    <>
      <Screen bottomPad={128}>
        {/* DESIGN.md: the step name and the remaining time stay at the top (the logo row scrolls away). */}
        <div className="sticky -top-12 z-20 -mx-[var(--gutter)] bg-canvas px-[var(--gutter)] pb-2">
          <StepHeader
            title="발표 중"
            onBack={stage === "live" ? () => setConfirm("back") : () => router.push(`/setup?s=${id}`)}
            right={
              <HeaderPill outline onClick={() => (stage === "live" ? setConfirm("exit") : router.push("/history"))}>
                종료
              </HeaderPill>
            }
          />
          <Timer label={resumeSec ? "발표 남은 시간 · 이어하기" : "발표 남은 시간"} remaining={remaining} total={total} compact />
        </div>

        <div className="mt-3 flex flex-col gap-3 [--slide-max-h:min(260px,calc(var(--app-h)*0.3))]">
          {deck === null ? (
            <div className="flex aspect-video items-center justify-center rounded-[28px] bg-card p-6 text-center text-[15px] text-secondary" role="status">
              발표 자료를 불러오지 못했어요. 자료 없이 발표를 이어 갈 수 있어요.
            </div>
          ) : deck === undefined ? (
            <div className="aspect-video animate-pulse rounded-[28px] bg-card" role="status" aria-label="발표 자료 불러오는 중" />
          ) : (
            <SlideViewer
              src={deck}
              initialPage={lastSlide}
              keyboard="global"
              label="발표 자료"
              onPageChange={(page) => {
                pageRef.current = page;
              }}
            >
              <div className="pointer-events-none absolute bottom-2 right-2">
                <CameraView stream={cam.stream} status={cameraViewStatus(cam.status)} variant="inset" />
              </div>
            </SlideViewer>
          )}
          {camOn && <MediaProblem device="camera" status={cam.status} onRetry={cam.retry} />}

          <section aria-labelledby="stt-h" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 id="stt-h" className="text-[17px] leading-6">
                <span className="font-bold">내 발표</span>
                <span className="text-secondary"> · {sttState}</span>
              </h2>
              <Waveform bars={14} level={listening ? stt.level : 0} active={listening} className="h-6 text-ink" />
            </div>
            <Bubble live>
              {bubbleText ? (
                <span className="line-clamp-2">
                  {bubbleText}
                  {listening && partial && <span className="ui-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] bg-ink" aria-hidden="true" />}
                </span>
              ) : (
                <span className="text-secondary">{stage === "ready" ? "발표를 시작하면 말한 내용을 문장 단위로 받아 적어요." : "말을 시작하면 여기에 받아 적어요."}</span>
              )}
            </Bubble>
            {micOn && stt.error && <MediaProblem device="mic" status={micStatusFromError(stt.error)} message={stt.error} onRetry={() => void stt.start(elapsed())} />}
            {stt.notice && <p className="px-1 text-[13px] text-secondary">{stt.notice}</p>}
            {saveError && (
              <p className="px-1 text-[13px] text-error" role="alert">
                {saveError}
              </p>
            )}
          </section>

          {judges.length > 0 && (
            <section aria-label="심사위원" className="mx-auto grid w-full max-w-[276px] grid-cols-3 gap-3">
              {judges.map((j) => (
                <SessionJudgeTile key={j.id} judge={j} />
              ))}
            </section>
          )}
        </div>
      </Screen>

      <BottomBar>
        <div className="flex items-center gap-2">
          <MediaToggle kind="mic" on={micOn} onToggle={toggleMic} />
          <span className="h-6 w-px bg-line" aria-hidden="true" />
          <MediaToggle kind="camera" on={camOn} onToggle={() => setCamOn((v) => !v)} />
        </div>
        {stage === "ready" ? (
          <Button onClick={begin} arrow>
            {resumeSec ? "이어서 발표하기" : "발표 시작"}
          </Button>
        ) : (
          <Button onClick={() => setConfirm("finish")} arrow disabled={stage === "ended"}>
            발표 마치기
          </Button>
        )}
      </BottomBar>

      <ConfirmDialog
        open={confirm === "finish"}
        title="발표를 마칠까요?"
        body="질의응답으로 넘어가요. 심사위원이 발표 내용을 바탕으로 질문해요."
        confirmLabel="발표 마치기"
        cancelLabel="계속 발표하기"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          await finish();
          router.push(`/qa?s=${id}`);
        }}
      />
      <ConfirmDialog
        open={confirm === "exit" || confirm === "back"}
        title={confirm === "back" ? "발표를 멈추고 나갈까요?" : "시뮬레이션을 종료할까요?"}
        body="지금까지 진행한 내용은 기록에 ‘진행 중’으로 남아요. 목록에서 이어서 할 수 있어요."
        confirmLabel={confirm === "back" ? "나가기" : "종료하기"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void leave(confirm === "back" ? `/setup?s=${id}` : "/history")}
      />
      <PhaseEndDialog
        open={timeUp}
        title="발표 시간이 끝났어요"
        body="이제 질의응답으로 넘어가요. 심사위원이 차례로 질문해요."
        nextLabel="질의응답 시작하기"
        href={`/qa?s=${id}`}
      />
    </>
  );
}
