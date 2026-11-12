import { useCallback, useEffect, useRef, useState } from "react";

export type MediaStatus = "pending" | "live" | "off" | "denied" | "nodevice" | "unsupported";

function classify(e: unknown): MediaStatus {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "nodevice";
  return "denied";
}

/** Front camera stream with permission-denied handling and retry. */
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    setStatus("pending");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((ms) => {
        if (cancelled) return ms.getTracks().forEach((t) => t.stop());
        s = ms;
        setStream(ms);
        setStatus("live");
      })
      .catch((e) => !cancelled && setStatus(classify(e)));
    return () => {
      cancelled = true;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { status, stream, retry };
}

/** Live microphone level (0–1) via AnalyserNode; null when unavailable. */
export function useMicLevel(enabled: boolean) {
  const [level, setLevel] = useState<number | null>(null);
  const [status, setStatus] = useState<MediaStatus>("pending");
  const [attempt, setAttempt] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let ms: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    if (!enabled) {
      setStatus("off"); // eslint-disable-line react-hooks/set-state-in-effect -- reflects external device state
      setLevel(null);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        ms = stream;
        setStatus("live");
        ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        let last = 0;
        const loop = (t: number) => {
          raf.current = requestAnimationFrame(loop);
          if (t - last < 90) return;
          last = t;
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
        };
        raf.current = requestAnimationFrame(loop);
      })
      .catch((e) => !cancelled && setStatus(classify(e)));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf.current);
      ms?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { level, status, retry };
}
