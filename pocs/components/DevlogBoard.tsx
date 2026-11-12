"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { POCS } from "@/lib/pocs";

type Evt = { ts: string; poc: string; status: string; msg: string; agent: string; file?: string };

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  in_progress: "개발 중",
  verifying: "검증 중",
  issue: "이슈",
  fixed: "수정됨",
  done: "완료",
  failed: "실패",
  note: "메모",
};
const STICKY = new Set(["queued", "in_progress", "verifying", "issue", "fixed", "done", "failed"]);

function fmt(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString("ko-KR", { hour12: false });
}

export function DevlogBoard({ compact = false }: { compact?: boolean }) {
  const [events, setEvents] = useState<Evt[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [live, setLive] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/devlog", { cache: "no-store" });
        const j = await r.json();
        if (alive) setEvents(j.events ?? []);
      } catch {}
    };
    load();
    const id = live ? setInterval(load, 2500) : undefined;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
  }, [live]);

  const byPoc = useMemo(() => {
    const m = new Map<string, { status?: string; last?: Evt; count: number }>();
    for (const e of events) {
      const cur = m.get(e.poc) ?? { count: 0 };
      cur.count++;
      cur.last = e;
      if (STICKY.has(e.status)) cur.status = e.status;
      m.set(e.poc, cur);
    }
    return m;
  }, [events]);

  const shown = useMemo(
    () => [...events].reverse().filter((e) => filter === "all" || e.poc === filter),
    [events, filter],
  );
  const known = new Set<string>(POCS.map((p) => p.key));
  const extra = [...byPoc.keys()].filter((k) => !known.has(k));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[...POCS.map((p) => ({ key: p.key as string, title: p.title as string, path: p.path as string | null })), ...extra.map((k) => ({ key: k, title: k, path: null }))].map((p) => {
          const s = byPoc.get(p.key);
          const st = s?.status ?? "queued";
          const dark = st === "done";
          return (
            <button
              key={p.key}
              onClick={() => setFilter(filter === p.key ? "all" : p.key)}
              className={`text-left rounded-[20px] p-4 transition-colors ${dark ? "bg-ink text-inverse" : "bg-surface"} ${filter === p.key ? "ring-2 ring-ink ring-offset-2" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{p.title}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${dark ? "bg-white/15" : st === "failed" || st === "issue" ? "bg-[#fde8e6] text-error" : "bg-card"}`}>
                  {STATUS_LABEL[st] ?? st}
                  {(st === "in_progress" || st === "verifying") && <span className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-current animate-pulse align-middle" />}
                </span>
              </div>
              <p className={`mt-2 text-[13px] leading-5 line-clamp-2 ${dark ? "text-white/70" : "text-secondary"}`}>{s?.last?.msg ?? "아직 이벤트 없음"}</p>
              <div className={`mt-2 text-xs tabular ${dark ? "text-white/60" : "text-secondary"}`}>
                {s?.count ?? 0} events{s?.last ? ` · ${fmt(s.last.ts)}` : ""}
                {p.path && (
                  <Link href={p.path} onClick={(e) => e.stopPropagation()} className="ml-2 underline">
                    열기
                  </Link>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {!compact && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold">타임라인 {filter !== "all" && <span className="text-secondary font-normal">· {filter}</span>}</h2>
            <label className="text-sm text-secondary flex items-center gap-2">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> 실시간(2.5s)
            </label>
          </div>
          <ol className="flex flex-col divide-y divide-line rounded-[20px] bg-surface">
            {shown.length === 0 && <li className="p-4 text-secondary">이벤트가 없습니다.</li>}
            {shown.map((e, i) => (
              <li key={i} className="p-3 sm:p-4 grid grid-cols-[72px_88px_1fr] gap-3 text-sm">
                <span className="tabular text-secondary">{fmt(e.ts)}</span>
                <span className="font-medium truncate">{e.poc}</span>
                <span>
                  <span className={`mr-2 text-xs px-2 py-0.5 rounded-full ${e.status === "done" ? "bg-ink text-inverse" : e.status === "failed" || e.status === "issue" ? "bg-[#fde8e6] text-error" : "bg-card"}`}>
                    {STATUS_LABEL[e.status] ?? e.status}
                  </span>
                  {e.msg}
                  {e.file && <code className="ml-2 text-xs text-secondary">{e.file}</code>}
                  <span className="ml-2 text-xs text-secondary">— {e.agent}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
