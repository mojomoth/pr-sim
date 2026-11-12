"use client";
import { useEffect, useRef, useState } from "react";
import { useSentenceTranscriber, type TranscriberMode } from "../client/useSentenceTranscriber";

const MODES: { key: TranscriberMode; label: string; desc: string }[] = [
  { key: "auto", label: "자동", desc: "Live 스트리밍을 쓰고, 연결이 안 되면 VAD+전사로 전환합니다." },
  { key: "live", label: "Live (A)", desc: "브라우저 → Gemini Live 직접 연결(에페메랄 토큰). 말하는 중에도 글자가 보입니다." },
  { key: "chunked", label: "VAD (B)", desc: "0.6초 침묵마다 구간을 잘라 서버에서 전사합니다. 중간 글자는 보이지 않습니다." },
];

const STATUS_LABEL = { idle: "대기", connecting: "연결 중", listening: "듣는 중", stopping: "마무리 중", error: "오류" } as const;

function mmss(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Meter({ level, active }: { level: number; active: boolean }) {
  const bars = [0.35, 0.6, 0.85, 1, 0.75, 0.5, 0.9, 0.65, 0.4];
  return (
    <div className="flex items-center gap-[3px] h-8" aria-hidden>
      {bars.map((b, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-ink transition-[height] duration-100"
          style={{ height: `${active ? Math.max(4, Math.min(32, 4 + level * 32 * b)) : 4}px`, opacity: active ? 1 : 0.3 }}
        />
      ))}
    </div>
  );
}

export function SttPanel() {
  const [mode, setMode] = useState<TranscriberMode>("auto");
  const t = useSentenceTranscriber({ mode, phase: "presentation" });
  const running = t.status === "listening" || t.status === "connecting" || t.status === "stopping";
  const [now, setNow] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!running || t.startedAt == null) return;
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [running, t.startedAt]);
  const elapsed = running && t.startedAt != null && now > t.startedAt ? (now - t.startedAt) / 1000 : 0;

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [t.sentences.length, t.partialSentences.length]);

  const lat = t.sentences.map((s) => s.latencyMs).filter((x): x is number => typeof x === "number");
  const avgLat = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
  const modeInfo = MODES.find((m) => m.key === mode)!;
  const partials = t.partialSentences.length ? t.partialSentences : t.inProgress && running ? [""] : [];
  // finished sentences and failed (B) segments, in time order
  const items = [
    ...t.sentences.map((s) => ({ kind: "sentence" as const, t: s.t, s })),
    ...t.failures.map((f) => ({ kind: "failure" as const, t: f.t, f })),
  ].sort((a, b) => a.t - b.t);
  const degraded = t.status === "listening" && !!t.warning;

  return (
    <section className="rounded-[28px] bg-surface p-5 sm:p-6 flex flex-col gap-5" aria-labelledby="stt-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-secondary">STT · Gemini</p>
          <h2 id="stt-title" className="text-xl leading-7 font-semibold tracking-[-0.4px]">실시간 문장 전사</h2>
        </div>
        <span
          data-testid="stt-status"
          data-degraded={degraded || undefined}
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${t.status === "error" || degraded ? "bg-canvas text-error" : t.status === "listening" ? "bg-ink text-inverse" : "bg-canvas text-ink"}`}
        >
          {t.status === "listening" && <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${degraded ? "bg-error" : "bg-inverse"}`} />}
          {degraded ? "듣는 중 · 전사 실패" : STATUS_LABEL[t.status]}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="전사 방식" className="grid grid-cols-3 gap-1 rounded-full bg-canvas p-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              role="radio"
              aria-checked={mode === m.key}
              disabled={running}
              onClick={() => setMode(m.key)}
              className={`min-h-11 rounded-full px-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${mode === m.key ? "bg-ink text-inverse" : "text-ink disabled:text-secondary"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs leading-[18px] text-secondary">
          {modeInfo.desc}
          {t.activeMode && running && <> · 현재 엔진: <b className="text-ink" data-testid="stt-engine">{t.activeMode === "live" ? "Live 스트리밍" : "VAD+전사"}</b></>}
        </p>
      </div>

      <ol ref={listRef} className="flex flex-col gap-2 min-h-[220px] max-h-[440px] overflow-y-auto -mx-1 px-1" aria-live="polite" aria-label="전사된 문장">
        {items.length === 0 && partials.length === 0 && (
          <li className="rounded-[20px] bg-canvas px-4 py-6 text-center text-secondary">
            시작을 누르고 한국어로 말해 보세요.
            <br />
            문장이 끝날 때마다 말풍선이 하나씩 생깁니다.
          </li>
        )}
        {items.map((it) =>
          it.kind === "sentence" ? (
            <li key={it.s.id} data-testid="sentence" data-status="final" className="rounded-[20px] bg-canvas px-4 py-3 flex flex-col gap-1">
              <span className="text-base leading-6">{it.s.text}</span>
              <span className="text-xs leading-[18px] text-secondary tabular">
                {mmss(it.s.t)} · 인식 완료{typeof it.s.latencyMs === "number" && <> · 지연 {(it.s.latencyMs / 1000).toFixed(1)}초</>}
              </span>
            </li>
          ) : (
            <li key={it.f.id} data-testid="segment-failed" className="rounded-[20px] border border-error/40 bg-canvas px-4 py-3 flex flex-col gap-1">
              <span className="text-base leading-6 text-error font-medium">이 구간을 전사하지 못했습니다</span>
              <span className="text-xs leading-[18px] text-secondary break-words">
                <span className="tabular">{mmss(it.f.t)}</span> · {it.f.message}
              </span>
            </li>
          ),
        )}
        {partials.map((p, i) => (
          <li key={`p${i}`} data-testid="sentence" data-status="partial" className="rounded-[20px] border border-dashed border-line bg-canvas/60 px-4 py-3 flex flex-col gap-1">
            <span className={`text-base leading-6 ${p ? "text-ink" : "text-secondary"}`}>{p || (t.speaking ? "말하는 중…" : "전사 중…")}</span>
            <span className="text-xs leading-[18px] text-secondary inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ink motion-safe:animate-pulse" /> 음성 인식 중
            </span>
          </li>
        ))}
      </ol>

      {t.error && (
        <div role="alert" className="rounded-[20px] bg-canvas px-4 py-3 flex flex-col gap-2">
          <p className="text-error font-medium text-sm" data-testid="stt-error">{t.error}</p>
          <button onClick={() => void t.start()} className="self-start min-h-11 rounded-full bg-ink text-inverse px-4 text-sm font-semibold">다시 시도</button>
        </div>
      )}
      {t.warning && !t.error && (
        <p role="alert" className="rounded-[16px] bg-canvas px-4 py-3 text-sm font-medium text-error" data-testid="stt-warning">{t.warning}</p>
      )}
      {t.notice && !t.error && <p className="text-xs text-secondary" data-testid="stt-notice">{t.notice}</p>}

      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3">
          <Meter level={t.level} active={t.status === "listening"} />
          <span className="text-2xl font-semibold tracking-[-1px] tabular" aria-label="경과 시간">{mmss(elapsed)}</span>
        </div>
        <span className="text-secondary tabular" data-testid="stt-metrics">
          {t.sentences.length}문장{avgLat != null && <> · 평균 지연 {(avgLat / 1000).toFixed(1)}초</>}
        </span>
      </div>

      <div className="flex gap-2">
        {!running ? (
          <button data-testid="stt-start" onClick={() => void t.start()} className="flex-1 h-14 rounded-[20px] bg-ink text-inverse font-semibold text-base">
            마이크 켜고 전사 시작
          </button>
        ) : (
          <button data-testid="stt-stop" onClick={() => void t.stop()} disabled={t.status === "stopping"} className="flex-1 h-14 rounded-[20px] bg-ink text-inverse font-semibold text-base disabled:opacity-60">
            {t.status === "stopping" ? "마무리 중…" : "전사 종료"}
          </button>
        )}
        <button onClick={t.reset} disabled={running || !t.sentences.length} className="h-14 rounded-[20px] bg-canvas px-5 font-semibold disabled:text-secondary">
          지우기
        </button>
      </div>
    </section>
  );
}
