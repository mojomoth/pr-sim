"use client";
import { useEffect, useRef } from "react";
import { Refresh, VideoOff } from "./Icons";

/** Same union as the platform media hook's status. */
type MediaStatus = "pending" | "live" | "off" | "denied" | "nodevice" | "unsupported";

const STATUS_TEXT: Record<MediaStatus, string> = {
  pending: "카메라 연결 중",
  live: "",
  off: "카메라 꺼짐",
  denied: "카메라 권한 필요",
  nodevice: "카메라 없음",
  unsupported: "지원되지 않는 브라우저",
};

/** My camera in full color (mirrored). Shows status text when not live. `variant="inset"` is a landscape 4:3 thumbnail with a white ring that overlays the slide (draft 03). */
export function CameraView({ stream, status, variant = "panel", className = "" }: { stream: MediaStream | null; status: MediaStatus; variant?: "inset" | "panel"; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
  }, [stream]);
  const inset = variant === "inset";
  return (
    <div
      className={`relative overflow-hidden bg-secondary/90 ${inset ? "aspect-[4/3] w-[104px] rounded-[14px] ring-[3px] ring-canvas" : "aspect-video w-full rounded-[28px]"} ${className}`}
      aria-label="내 카메라"
      role="img"
    >
      <video ref={video} muted playsInline autoPlay className={`absolute inset-0 h-full w-full -scale-x-100 object-cover ${status === "live" ? "" : "hidden"}`} />
      {status !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-card p-2 text-center text-secondary">
          <VideoOff size={inset ? 18 : 28} />
          <span className={`${inset ? "text-[11px] leading-4" : "text-[14px]"} font-medium`}>{STATUS_TEXT[status]}</span>
        </div>
      )}
      <span className={`absolute inline-flex items-center rounded-full bg-canvas font-bold ${inset ? "bottom-1.5 left-1.5 h-6 px-2 text-[12px]" : "bottom-2 left-2 h-8 px-3 text-[13px]"}`}>나</span>
    </div>
  );
}

/** Permission-denied guidance with retry (DESIGN.md: 권한 거부 시 권한 설정 안내와 재시도). */
export function PermissionNotice({ kind, onRetry }: { kind: "카메라" | "마이크"; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-[20px] border border-line bg-canvas px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{kind} 권한이 필요해요</p>
        <p className="text-[13px] leading-[18px] text-secondary">브라우저나 기기 설정에서 {kind} 접근을 허용한 뒤 다시 시도해 주세요.</p>
      </div>
      <button type="button" onClick={onRetry} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[14px] font-semibold text-inverse">
        <Refresh size={16} /> 다시 시도
      </button>
    </div>
  );
}
