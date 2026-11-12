"use client";
import { useCallback, useEffect, useState } from "react";

type P = { id: string; label: string; model: string; ok: boolean; ms: number; status: number | null; reason: string };
type Report = { checkedAt: string; cached: boolean; providers: P[] };

/** Live LLM provider availability (GET /api/hil/providers, cached 60s on the server). */
export function ProviderStatus() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/hil/providers${force ? "?force=1" : ""}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setReport((await r.json()) as Report);
    } catch (e) {
      setError(`상태를 확인하지 못했어요 (${(e as Error).message})`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/hil/providers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: Report) => alive && setReport(j))
      .catch((e: Error) => alive && setError(`상태를 확인하지 못했어요 (${e.message})`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const okCount = report?.providers.filter((p) => p.ok).length ?? 0;

  return (
    <section aria-labelledby="provider-h" className="rounded-[28px] bg-surface p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="provider-h" className="text-xl leading-7 font-semibold tracking-[-0.4px]">AI 제공자 상태</h2>
          <p className="mt-1 text-sm leading-5 text-secondary">
            {report
              ? `${report.providers.length}곳 중 ${okCount}곳 사용 가능 · ${new Date(report.checkedAt).toLocaleTimeString("ko-KR", { hour12: false })} 확인${report.cached ? " (캐시)" : ""}`
              : "실제로 한 번씩 호출해 확인해요"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="shrink-0 h-11 rounded-full bg-canvas px-4 text-sm font-semibold disabled:text-secondary"
        >
          {loading ? "확인 중…" : "다시 확인"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <ul className="flex flex-col gap-2">
        {(report?.providers ?? []).map((p) => (
          <li key={p.id} className="rounded-[20px] bg-canvas px-4 py-3 flex items-center gap-3">
            <span
              aria-hidden
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${p.ok ? "bg-ink text-inverse" : "border-2 border-error text-error"}`}
            >
              {p.ok ? "✓" : "!"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {p.label} <span className="font-normal text-secondary text-sm">{p.model}</span>
              </p>
              <p className={`text-sm leading-5 ${p.ok ? "text-secondary" : "text-error"}`}>
                {p.ok ? "사용 가능" : "사용 불가"} · {p.reason}
              </p>
            </div>
            <span className="tabular text-xs text-secondary shrink-0">{p.ms}ms</span>
          </li>
        ))}
        {!report && loading && <li className="rounded-[20px] bg-canvas px-4 py-3 text-sm text-secondary">세 제공자에 짧은 요청을 보내는 중…</li>}
      </ul>
      <p className="text-xs leading-[18px] text-secondary">
        Claude·OpenAI가 막혀 있으면 위키 새 인제스트, 심사위원 얼굴 생성, 질문 생성, 리포트 채점이 실패하거나 Gemini 경량 모델로 대체돼요. 이미 저장된 결과(위키, 갤러리, 저장된 실행, 저장된 리포트)는 그대로 볼 수 있어요.
      </p>
    </section>
  );
}
