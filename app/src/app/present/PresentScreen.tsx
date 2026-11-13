"use client";
// 03 · 발표 — remaining time, PDF slides with my camera, live transcript, the judges.
// The transcript is saved sentence by sentence and the remaining time every few seconds, so a reload
// or 연습 기록 → 이어서 진행 resumes where the presenter left off.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomBar, Button } from "@/components/Button";
import { CameraView } from "@/components/CameraView";
import { ConfirmDialog, PhaseEndDialog } from "@/components/Dialog";
import { StepHeader } from "@/components/Header";
import { Screen } from "@/components/Layout";
import { Timer } from "@/components/Timer";
import { Waveform } from "@/components/Waveform";
import { getBlob, updateSession } from "@/features/session/db";
import type { SessionRecord, TranscriptSentence } from "@/features/session/types";
import { useCountdown, useSecondsOverride } from "@/features/session/useCountdown";
import { SlideViewer } from "@/features/slide/SlideViewer";
import { useSentenceTranscriber } from "@/features/stt/useSentenceTranscriber";
import { sessionVocabulary } from "@/features/stt/vocab";
import { platform, useCamera, type MediaStatus } from "@/platform";
import { cameraViewStatus, DeviceToggle, EndPill, LoadFailed, LoadingScreen, MediaProblem, micStatusFromError, MissingSession, SessionJudgeTile, useSessionFromQuery } from "./shared";

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
  if (s.state === "error") return <LoadFailed onRetry={s.retry} />;
  return <Presentation key={s.rec.id} rec={s.rec} />;
}

type Stage = "ready" | "live" | "ended";
/** Draft 03 CTA: a bit lower than the app's 56px button, radius ≈30% of the height. */
const CTA = "h-12! rounded-[14px]!";
/** Bottom bar height without the safe area: pt-3 + 44px toggles + gap-2 + 48px CTA. */
const BAR_H = 112;

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
  /** A required save failed: this retries it (and then continues where it stopped). */
  const [saveRetry, setSaveRetry] = useState<null | (() => void)>(null);

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
  // The mic records only from 발표 시작, but its permission is asked here in the ready stage, right
  // after the camera prompt settles (one prompt at a time), so the presenter isn't stopped at the start.
  const [micPrep, setMicPrep] = useState<MediaStatus>("pending");
  const askMic = useCallback(() => void platform.requestPermission("mic").then(setMicPrep), []);
  const askedMic = useRef(false);
  useEffect(() => {
    if (askedMic.current || stage !== "ready" || !micOn || cam.status === "pending") return;
    askedMic.current = true;
    askMic();
  }, [stage, micOn, cam.status, askMic]);

  // Every sentence of this visit; the phase-ending save re-adds any whose own save failed.
  const said = useRef<TranscriptSentence[]>([]);
  const persistSentence = useCallback(
    (x: TranscriptSentence) => {
      said.current.push(x);
      updateSession(id, (cur) => ({ ...cur, transcript: [...cur.transcript, x] })).catch(() => setSaveError("말한 내용을 저장하지 못했어요. 저장 공간을 확인해 주세요."));
    },
    [id],
  );
  const withSaid = (cur: SessionRecord): TranscriptSentence[] => {
    const have = new Set(cur.transcript.map((x) => x.id));
    return [...cur.transcript, ...said.current.filter((x) => !have.has(x.id))];
  };
  const vocabulary = useMemo(() => sessionVocabulary([rec.docs.presentation, rec.docs.proposal]), [rec.docs]);
  const stt = useSentenceTranscriber({ phase: "presentation", getSlide: () => pageRef.current, onSentence: persistSentence, vocabulary });

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

  // A confirm sheet pauses the countdown, so it pauses the transcriber too (otherwise words spoken
  // meanwhile get times past the clock, and sentences after it resumes go back in time).
  const stageRef = useRef(stage);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  const paused = useRef<Promise<unknown> | null>(null);
  const openConfirm = (kind: "exit" | "back" | "finish") => {
    setConfirm(kind);
    if (micOn && !paused.current) paused.current = stt.stop();
  };
  const closeConfirm = async () => {
    setConfirm(null);
    const p = paused.current;
    if (!p) return;
    await p;
    paused.current = null;
    if (micOn && stageRef.current === "live") void stt.start(elapsed());
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

  /**
   * End the presentation (time up or 발표 마치기): wait for the last words, then save them with the
   * Q&A status. Only a successful save moves on (`then`); a failed one shows a retry and stays here.
   */
  const finish = async (then: () => void) => {
    setStage("ended");
    stageRef.current = "ended";
    await paused.current;
    await stt.stop();
    const save = async () => {
      setSaveRetry(null);
      try {
        await updateSession(id, (cur) => ({ ...cur, transcript: withSaid(cur), status: "qa", resume: undefined }));
      } catch {
        setSaveError("발표 기록을 저장하지 못해 질의응답으로 넘어가지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요.");
        setSaveRetry(() => () => void save());
        return;
      }
      setSaveError(null);
      then();
    };
    await save();
  };
  useEffect(() => {
    finishRef.current = () => void finish(() => setTimeUp(true));
  });

  const leave = async (to: string) => {
    setConfirm(null);
    if (stage !== "live") return router.push(to);
    setStage("ended");
    stageRef.current = "ended";
    await paused.current;
    await stt.stop();
    const save = async () => {
      setSaveRetry(null);
      try {
        await updateSession(id, (cur) => ({ ...cur, transcript: withSaid(cur), status: "presentation", resume: { phase: "presentation", remainingSec: Math.max(1, Math.ceil(remRef.current)) } }));
      } catch {
        setSaveError("기록을 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요.");
        setSaveRetry(() => () => void save());
        return;
      }
      router.push(to);
    };
    await save();
  };

  // ── transcript bubble ──
  const listening = stt.status === "listening";
  const partial = stt.partialSentences.at(-1);
  const lastFinal = stt.sentences.at(-1)?.text ?? [...rec.transcript].reverse().find((x) => x.phase === "presentation")?.text;
  const bubbleText = partial ?? lastFinal;
  const sttState =
    stage === "ready"
      ? "시작 전"
      : stage === "ended"
        ? "발표 종료"
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
  const micPrepProblem = stage === "ready" && micPrep !== "pending" && micPrep !== "live" ? micPrep : undefined;
  const micProblem: MediaStatus | undefined = micStatusFromError(stt.error) ?? micPrepProblem;

  return (
    // Draft 03 runs content closer to the screen edge than the 24px app gutter.
    <div className="contents [--gutter:16px]">
      <Screen bottomPad={BAR_H}>
        {/* DESIGN.md: the step name and the remaining time stay at the top (the logo row scrolls away).
            Like every screen, the back chevron sits on the logo row and only 종료 on the title row. */}
        <div className="sticky -top-12 z-20 -mx-[var(--gutter)] bg-canvas px-[var(--gutter)] pb-3">
          <StepHeader
            title="발표 중"
            onBack={stage === "live" ? () => openConfirm("back") : () => router.push(`/setup?s=${id}`)}
            right={<EndPill outline onClick={() => (stage === "live" ? openConfirm("exit") : router.push("/history"))} />}
          />
          <div className="mt-2">
            <Timer label={resumeSec ? "발표 남은 시간 · 이어서 진행" : "발표 남은 시간"} remaining={remaining} total={total} compact />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 [--slide-max-h:clamp(160px,calc(var(--app-h)-var(--safe-bottom-pad)-627px),260px)]">
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
              variant="presenter"
              onPageChange={(page) => {
                pageRef.current = page;
              }}
            >
              {/* Draft 03: hangs over the slide's bottom edge, beside the (left-shifted) slide controls. */}
              <div className="pointer-events-none absolute bottom-[18px] right-2">
                {/* Not live: the status text fills the small tile, so the "나" badge would cover it. */}
                <CameraView stream={cam.stream} status={cameraViewStatus(cam.status)} variant="inset" className={`max-[359px]:w-[88px] ${cam.status === "live" ? "" : "[&>span]:hidden"}`} />
              </div>
            </SlideViewer>
          )}
          {camOn && <MediaProblem device="camera" status={cam.status} onRetry={cam.retry} />}

          <section aria-labelledby="stt-h" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 id="stt-h" className="text-[17px] leading-6">
                <span className="font-bold">내 발표</span>
                <span className="text-[15px]"> · {sttState}</span>
              </h2>
              <Waveform bars={14} level={listening ? stt.level : 0} active={listening} className="h-6 text-ink" />
            </div>
            {/* Fixed two-line height (draft 03), so a wrapping sentence never pushes the judges under the bottom bar. */}
            <div className="flex h-14 items-center rounded-[18px] bg-surface px-4 text-[15px] leading-[22px]" aria-live="polite">
              <span className={`line-clamp-2 ${bubbleText ? "" : "text-secondary"}`}>
                {bubbleText ?? (stage === "ready" ? "발표를 시작하면 말한 내용을 문장 단위로 받아 적어요." : "말을 시작하면 여기에 받아 적어요.")}
              </span>
            </div>
            {micOn && stt.error && <MediaProblem device="mic" status={micStatusFromError(stt.error)} message={stt.error} onRetry={() => void stt.start(elapsed())} />}
            {micOn && !stt.error && micPrepProblem && <MediaProblem device="mic" status={micPrepProblem} onRetry={askMic} />}
            {stt.notice && <p className="px-1 text-[13px] text-secondary">{stt.notice}</p>}
            {saveError && (
              <div role="alert" className="flex items-center gap-3 px-1">
                <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-error">{saveError}</p>
                {saveRetry && (
                  <button type="button" onClick={saveRetry} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[14px] font-semibold text-inverse">
                    다시 시도
                  </button>
                )}
              </div>
            )}
          </section>

          {judges.length > 0 && (
            // Draft 03: three tiles fill the width. Their height follows the space left above the bottom
            // bar (taller phones get near-square tiles; the desktop frame, with its home-indicator inset,
            // gets shorter ones) so the names never run into the bar. Photo crop stays full color.
            // Budget: 756px = everything else at 390×844 with the 192px slide; on shorter screens the slide
            // (--slide-max-h above, 627px = the rest + a 64px tile) gives way first, down to 160px; below
            // that the page scrolls instead of shrinking the slide further.
            <section
              aria-label="심사위원"
              className="flex w-full justify-center gap-3 [&>figure]:w-[calc((100%-24px)/3)] [&>figure]:flex-none [&_figure>div]:aspect-auto [&_figure>div]:h-[clamp(64px,calc(var(--app-h)-var(--safe-bottom-pad)-756px),104px)] [&_figure>div]:rounded-[12px] [&_figure>div>div]:rounded-[12px] [&_img]:object-[50%_30%]"
            >
              {judges.map((j) => (
                <SessionJudgeTile key={j.id} judge={j} />
              ))}
            </section>
          )}
        </div>
      </Screen>

      <BottomBar line={false}>
        <div className="flex items-center gap-2 px-4">
          <DeviceToggle kind="mic" on={micOn} problem={micProblem} onToggle={toggleMic} />
          <span className="h-6 w-px bg-line" aria-hidden="true" />
          <DeviceToggle kind="camera" on={camOn} problem={cam.status === "live" ? undefined : cam.status} onToggle={() => setCamOn((v) => !v)} />
        </div>
        {stage === "ready" ? (
          <Button onClick={begin} arrow className={CTA}>
            {resumeSec ? "이어서 발표하기" : "발표 시작"}
          </Button>
        ) : (
          <Button onClick={() => openConfirm("finish")} arrow disabled={stage === "ended"} className={CTA}>
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
        onClose={() => void closeConfirm()}
        onConfirm={() => {
          setConfirm(null);
          void finish(() => router.push(`/qa?s=${id}`));
        }}
      />
      <ConfirmDialog
        open={confirm === "exit" || confirm === "back"}
        title={confirm === "back" ? "발표를 멈추고 나갈까요?" : "시뮬레이션을 종료할까요?"}
        body="지금까지 진행한 내용은 연습 기록에 ‘진행 중’으로 남아요. 연습 기록에서 이어서 할 수 있어요."
        confirmLabel={confirm === "back" ? "나가기" : "종료하기"}
        onClose={() => void closeConfirm()}
        onConfirm={() => void leave(confirm === "back" ? `/setup?s=${id}` : "/history")}
      />
      <PhaseEndDialog
        open={timeUp}
        title="발표 시간이 끝났어요"
        body="이제 질의응답으로 넘어가요. 심사위원이 차례로 질문해요."
        nextLabel="질의응답 시작하기"
        href={`/qa?s=${id}`}
      />
    </div>
  );
}
