"use client";
// Camera stream (front camera) + shared permission/error classification for camera and microphone.
import { useCallback, useEffect, useState } from "react";

/** "pending" while asking, "live" when streaming, "off" when not requested; the rest are failures. */
export type MediaStatus = "pending" | "live" | "off" | "denied" | "nodevice" | "busy" | "unsupported" | "insecure";
export type MediaFailure = Exclude<MediaStatus, "pending" | "live" | "off">;
export type MediaDevice = "camera" | "mic";

const DEVICE_NAME: Record<MediaDevice, string> = { camera: "카메라", mic: "마이크" };

/** Korean message for a failed camera/microphone request. */
export function mediaErrorText(device: MediaDevice, status: MediaFailure): string {
  const d = DEVICE_NAME[device];
  switch (status) {
    case "denied":
      return `${d} 권한이 거부됐어요. 브라우저 주소창의 권한 설정에서 ${d}를 허용한 뒤 다시 시도해 주세요.`;
    case "nodevice":
      return `사용할 수 있는 ${d}를 찾지 못했어요. 연결 상태를 확인해 주세요.`;
    case "busy":
      return `다른 앱이 ${d}를 쓰고 있어요. 그 앱을 닫은 뒤 다시 시도해 주세요.`;
    case "insecure":
      return `${d}는 보안 연결(HTTPS)에서만 쓸 수 있어요.`;
    case "unsupported":
      return `이 브라우저에서는 ${d}를 쓸 수 없어요.`;
  }
}

export class MediaAccessError extends Error {
  constructor(
    public status: MediaFailure,
    device: MediaDevice,
  ) {
    super(mediaErrorText(device, status));
    this.name = "MediaAccessError";
  }
}

/** Why getUserMedia can't even be called here (null = it can). */
export function mediaUnavailable(): MediaFailure | null {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  return null;
}

export function classifyMediaError(e: unknown): MediaFailure {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "nodevice";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  if (name === "TypeError") return "unsupported";
  return "denied";
}

/** Current permission without prompting ("unknown" where the Permissions API can't tell, e.g. Safari < 16). */
export async function queryPermission(device: MediaDevice): Promise<PermissionState | "unknown"> {
  try {
    const name = (device === "camera" ? "camera" : "microphone") as PermissionName;
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return "unknown";
  }
}

function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Open the front camera. Throws MediaAccessError. Caller stops it with stopStream(). */
async function openCamera(): Promise<MediaStream> {
  const why = mediaUnavailable();
  if (why) throw new MediaAccessError(why, "camera");
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (e) {
    throw new MediaAccessError(classifyMediaError(e), "camera");
  }
}

/**
 * Front camera as React state. `enabled=false` stops the tracks (status "off");
 * `retry()` asks again after a denial. Tracks are always stopped on unmount.
 */
export function useCamera(enabled: boolean) {
  const [status, setStatus] = useState<MediaStatus>("pending");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let s: MediaStream | null = null;
    if (!enabled) {
      setStatus("off"); // eslint-disable-line react-hooks/set-state-in-effect -- reflects external device state
      setStream(null);
      return;
    }
    setStatus("pending");
    openCamera()
      .then((ms) => {
        if (cancelled) return stopStream(ms);
        s = ms;
        setStream(ms);
        setStatus("live");
        // Track ended underneath us (device unplugged, permission revoked mid-session).
        ms.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!cancelled) {
            setStream(null);
            setStatus("nodevice");
          }
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setStatus(e instanceof MediaAccessError ? e.status : "denied");
      });
    return () => {
      cancelled = true;
      stopStream(s);
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { status, stream, retry };
}
