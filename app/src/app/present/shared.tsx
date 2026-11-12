"use client";
// Shared by /present and /qa: load the session named by ?s=, the not-found state, judge faces from
// IndexedDB blobs, and the camera/mic problem notice.
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { PermissionNotice } from "@/components/CameraView";
import { Refresh } from "@/components/Icons";
import { JudgeAvatar, JudgeHero, JudgeTile, type JudgeView } from "@/components/JudgeCard";
import { Screen } from "@/components/Layout";
import { getSession, useBlobUrl } from "@/features/session/db";
import type { SessionRecord, StoredJudge } from "@/features/session/types";
import { mediaErrorText, type MediaStatus } from "@/platform";
import { TEMPERAMENT_LABEL } from "@/server/types";

type Loaded = { state: "loading" } | { state: "missing" } | { state: "ready"; rec: SessionRecord };

/** The session named by ?s=<id> (read once; screens persist through updateSession). */
export function useSessionFromQuery(): Loaded & { id: string } {
  const id = useSearchParams().get("s") ?? "";
  const [loaded, setLoaded] = useState<{ id: string; value: Loaded }>({ id: "", value: { state: "loading" } });
  useEffect(() => {
    let cancelled = false;
    (id ? getSession(id) : Promise.resolve(undefined))
      .then((rec) => !cancelled && setLoaded({ id, value: rec ? { state: "ready", rec } : { state: "missing" } }))
      .catch(() => !cancelled && setLoaded({ id, value: { state: "missing" } }));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return { id, ...(loaded.id === id ? loaded.value : { state: "loading" }) };
}

export function LoadingScreen() {
  return (
    <Screen>
      <p className="mt-24 text-center text-[15px] text-secondary" role="status">
        기록을 불러오고 있어요…
      </p>
    </Screen>
  );
}

export function MissingSession() {
  return (
    <Screen>
      <div className="mt-24 flex flex-col items-center gap-3 text-center" role="alert">
        <p className="text-[20px] font-semibold">기록을 찾을 수 없어요</p>
        <p className="text-[15px] leading-[22px] text-secondary">삭제됐거나 다른 기기에서 만든 기록이에요. 목록에서 다시 골라 주세요.</p>
        <div className="mt-4 flex w-full flex-col gap-2">
          <Button href="/history">기록 목록으로</Button>
          <Button href="/setup" variant="secondary">
            새로 시작하기
          </Button>
        </div>
      </div>
    </Screen>
  );
}

function useJudgeView(judge: StoredJudge, full?: boolean): JudgeView {
  const imageUrl = useBlobUrl(full ? judge.imageKey : judge.thumbKey);
  return { name: judge.name, persona: TEMPERAMENT_LABEL[judge.temperament], imageUrl };
}

export function SessionJudgeTile({ judge, speaking }: { judge: StoredJudge; speaking?: boolean }) {
  return <JudgeTile judge={useJudgeView(judge)} speaking={speaking} />;
}

export function SessionJudgeHero({ judge, speaking }: { judge: StoredJudge; speaking: boolean }) {
  return <JudgeHero judge={useJudgeView(judge, true)} speaking={speaking} />;
}

export function SessionJudgeAvatar({ judge, size }: { judge: StoredJudge; size?: number }) {
  return <JudgeAvatar judge={useJudgeView(judge)} size={size} />;
}

/** CameraView knows fewer states than the platform hook. */
export function cameraViewStatus(s: MediaStatus): "pending" | "live" | "off" | "denied" | "nodevice" | "unsupported" {
  return s === "busy" ? "nodevice" : s === "insecure" ? "unsupported" : s;
}

/** Denied → permission guide; other failures → the platform's Korean message. Both with retry. */
export function MediaProblem({ device, status, message, onRetry }: { device: "camera" | "mic"; status?: MediaStatus; message?: string; onRetry: () => void }) {
  if (status === "denied") return <PermissionNotice kind={device === "camera" ? "카메라" : "마이크"} onRetry={onRetry} />;
  const text = message ?? (status && status !== "pending" && status !== "live" && status !== "off" ? mediaErrorText(device, status) : null);
  if (!text) return null;
  return (
    <div role="alert" className="flex items-center gap-3 rounded-[20px] border border-line bg-canvas px-4 py-3">
      <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-secondary">{text}</p>
      <button type="button" onClick={onRetry} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[14px] font-semibold text-inverse">
        <Refresh size={16} /> 다시 시도
      </button>
    </div>
  );
}

/** The transcriber reports a denied microphone with the platform's message: map it back to a status. */
export function micStatusFromError(error: string | null): MediaStatus | undefined {
  return error && error === mediaErrorText("mic", "denied") ? "denied" : undefined;
}
