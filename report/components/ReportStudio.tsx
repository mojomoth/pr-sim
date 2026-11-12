"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProgressEvent, Report, SessionSummary, StepInfo } from "../lib/types";
import { Arrow, Card, CheckIcon, Chevron, H2, Label, Pill, Spinner } from "./parts";
import { DetailView, ResultView, type DetailTab, qaHeadline } from "./ReportViews";

type View = "pick" | "progress" | "result" | "detail";

const GROUPS: { id: StepInfo["group"]; label: string }[] = [
  { id: "prep", label: "준비" },
  { id: "speech", label: "1. 발표 분석 (STT)" },
  { id: "qa", label: "2. 질의응답 타당성" },
  { id: "materials", label: "3. 자료 품질" },
  { id: "overall", label: "4. 종합" },
];

export function ReportStudio() {
  const params = useSearchParams();
  const initial = useRef({ ref: params.get("session"), view: params.get("view"), tab: params.get("tab") as DetailTab | null });

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initial.current.ref);
  const [view, setView] = useState<View>("pick");
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastForce, setLastForce] = useState(false);
  const [retryable, setRetryable] = useState(true);
  const [tab, setTab] = useState<DetailTab>(initial.current.tab ?? "qa");
  const [qaIndex, setQaIndex] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const r = await fetch("/api/report/sessions", { cache: "no-store" });
    const list = (await r.json()) as SessionSummary[];
    setSessions(list);
    return list;
  }, []);

  const openReport = useCallback(async (key: string, v: View = "result") => {
    const r = await fetch(`/api/report/reports/${key}`, { cache: "no-store" });
    if (!r.ok) return false;
    setReport((await r.json()) as Report);
    setView(v);
    return true;
  }, []);

  // initial: list sessions; deep link ?session=<ref>&view=result|detail&tab=… opens the cached report
  useEffect(() => {
    let alive = true;
    fetch("/api/report/sessions", { cache: "no-store" })
      .then((r) => r.json() as Promise<SessionSummary[]>)
      .then((list) => {
        if (!alive) return;
        setSessions(list);
        const want = initial.current.ref;
        const s = list.find((x) => x.id === want) ?? null;
        if (!want || !s) setSelected((cur) => cur ?? list[0]?.id ?? null);
        if (s?.reportKey && (initial.current.view === "result" || initial.current.view === "detail")) void openReport(s.reportKey, initial.current.view as View);
      })
      .catch(() => alive && setError("세션 목록을 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [openReport]);

  // keep the URL in sync (shareable deep links for HIL)
  useEffect(() => {
    const u = new URL(window.location.href);
    if (selected) u.searchParams.set("session", selected);
    u.searchParams.set("view", view === "progress" ? "pick" : view);
    if (view === "detail") u.searchParams.set("tab", tab);
    else u.searchParams.delete("tab");
    window.history.replaceState(null, "", u.toString());
  }, [selected, view, tab]);

  useEffect(() => {
    if (view !== "progress") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [view]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, tab, qaIndex]);

  const current = useMemo(() => sessions?.find((s) => s.id === selected) ?? null, [sessions, selected]);

  async function generate(force: boolean) {
    if (!selected) return;
    setError(null);
    setLastForce(force);
    setRetryable(true);
    setReport(null);
    setSteps([]);
    setStartedAt(Date.now());
    setNow(Date.now());
    setView("progress");
    try {
      const res = await fetch("/api/report/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: selected, force }) });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done: Report | null = null;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const e = JSON.parse(line) as ProgressEvent;
          if (e.type === "steps") setSteps(e.steps);
          else if (e.type === "step") setSteps((cur) => cur.map((s) => (s.id === e.step.id ? e.step : s)));
          else if (e.type === "done") done = e.report;
          else if (e.type === "error") {
            setRetryable(e.retryable !== false);
            throw new Error(e.error);
          }
        }
      }
      if (!done) throw new Error("응답이 끊겼어요");
      setReport(done);
      setQaIndex(0);
      setView("result");
      void loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function savePaste() {
    setPasteMsg(null);
    let data: unknown;
    try {
      data = JSON.parse(paste);
    } catch {
      setPasteMsg("JSON 형식이 아니에요.");
      return;
    }
    const r = await fetch("/api/report/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const j = (await r.json()) as { ref?: string; error?: string; detail?: string; renamed?: boolean; duplicate?: boolean };
    if (!r.ok || !j.ref) {
      setPasteMsg(`${j.error ?? "저장 실패"}${j.detail ? ` — ${j.detail.slice(0, 160)}` : ""}`);
      return;
    }
    await loadSessions();
    setSelected(j.ref);
    setPaste("");
    setPasteOpen(false);
    setPasteMsg(null);
    setPasteNote(
      j.duplicate
        ? "같은 내용의 세션이 이미 있어 그 세션을 선택했어요."
        : j.renamed
          ? `같은 id의 다른 세션이 있어 덮어쓰지 않고 '${j.ref.replace(/^saved:/, "")}'로 따로 저장했어요.`
          : null,
    );
  }

  const title = view === "pick" ? "리포트 생성" : view === "progress" ? "분석 중" : view === "result" ? "종합 결과" : "상세 피드백";
  const back = view === "detail" ? () => setView("result") : view === "result" || view === "progress" ? () => setView("pick") : null;
  const right =
    view === "detail" && tab === "qa" && report?.qa.length ? (
      <span className="inline-flex h-11 min-w-11 items-center justify-center rounded-full bg-surface px-4 text-[15px] font-semibold tabular">
        {Math.min(qaIndex + 1, report.qa.length)} / {report.qa.length}
      </span>
    ) : view === "result" ? (
      <button type="button" onClick={() => setView("pick")} className="inline-flex h-11 items-center rounded-full bg-surface px-4 text-[15px] font-semibold">
        기록
      </button>
    ) : (
      <Link href="/devlog" className="inline-flex h-11 items-center rounded-full bg-surface px-4 text-[15px] font-semibold">
        devlog
      </Link>
    );

  const wide = view === "detail";
  return (
    <main className={`mx-auto w-full ${wide ? "max-w-[880px]" : "max-w-[560px]"} px-[var(--gutter)] pb-16`}>
      <div className="flex h-14 items-center">
        <Link href="/" aria-label="PoC 허브" className="flex items-center gap-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo */}
          <img src="/brand/lockup.svg" alt="PR·SIM" height={28} style={{ height: 28, width: "auto" }} />
        </Link>
      </div>
      <header className="grid h-14 grid-cols-[1fr_auto_1fr] items-center">
        <div className="justify-self-start">
          {back && (
            <button type="button" aria-label="뒤로 가기" onClick={back} className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface">
              <Chevron />
            </button>
          )}
        </div>
        <h1 className="text-[20px] font-bold leading-7 tracking-[-0.4px]">{title}</h1>
        <div className="justify-self-end">{right}</div>
      </header>

      {view === "pick" && (
        <div className="flex flex-col gap-5 pt-4">
          <div>
            <h2 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">어떤 연습을 분석할까요?</h2>
            <p className="mt-1 text-[16px] leading-6 text-secondary">발표 전사·질의응답·자료를 평가해 리포트를 만들어요.</p>
          </div>
          {!sessions && !error && (
            <p className="flex items-center gap-2 text-secondary">
              <Spinner /> 세션을 불러오는 중…
            </p>
          )}
          <div role="radiogroup" aria-label="세션 선택" className="flex flex-col gap-3" data-testid="sessions">
            {sessions?.map((s) => {
              const on = s.id === selected;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSelected(s.id)}
                  className={`flex flex-col gap-1.5 rounded-[20px] p-4 text-left ${on ? "bg-ink text-inverse" : "bg-surface"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-semibold">{s.label}</span>
                    {s.reportTotal != null && (
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-bold tabular ${on ? "bg-canvas text-ink" : "bg-canvas"}`}>{s.reportTotal}점</span>
                    )}
                  </span>
                  <span className={`line-clamp-2 text-[15px] leading-[22px] ${on ? "text-inverse/80" : "text-secondary"}`}>{s.situation}</span>
                  <span className={`text-[12px] tabular ${on ? "text-inverse/70" : "text-secondary"}`}>
                    발표 {s.presentationMinutes}분 · 질의응답 {s.qaMinutes}분 · 전사 {s.sentences}문장 · 질문 {s.questions}개
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-[20px] border border-line p-4">
            <button type="button" className="flex w-full items-center justify-between text-[15px] font-semibold" aria-expanded={pasteOpen} onClick={() => setPasteOpen((v) => !v)}>
              SessionRecord JSON 붙여넣기
              <span aria-hidden>{pasteOpen ? "−" : "+"}</span>
            </button>
            {pasteOpen && (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={6}
                  placeholder='{"id":"…","situation":"…","presentationMinutes":5,"qaMinutes":3,"judges":[…],"transcript":[…],"qa":[…],"createdAt":"…"}'
                  className="min-h-[52px] w-full rounded-[16px] bg-surface p-3 font-mono text-[12px] leading-[18px] outline-none focus:ring-2 focus:ring-ink"
                  aria-label="SessionRecord JSON"
                />
                {pasteMsg && <p className="text-[13px] text-error">{pasteMsg}</p>}
                <button type="button" onClick={savePaste} disabled={!paste.trim()} className="h-12 rounded-[20px] bg-surface text-[15px] font-semibold disabled:text-secondary">
                  세션 추가
                </button>
              </div>
            )}
            {pasteNote && !pasteOpen && (
              <p className="mt-2 text-[13px] leading-5 text-secondary" data-testid="paste-note">
                {pasteNote}
              </p>
            )}
          </div>

          {error && <p className="text-[14px] text-error">{error}</p>}

          <div className="sticky bottom-0 -mx-[var(--gutter)] flex flex-col gap-2 border-t border-line bg-canvas px-[var(--gutter)] pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
            {current?.reportKey ? (
              <>
                <button type="button" onClick={() => current.reportKey && openReport(current.reportKey)} className="flex h-14 items-center justify-center gap-2 rounded-[20px] bg-ink text-[16px] font-semibold text-inverse" data-testid="open">
                  저장된 리포트 보기 <Arrow />
                </button>
                <button type="button" onClick={() => generate(true)} className="h-12 rounded-[20px] bg-surface text-[15px] font-semibold" data-testid="regenerate">
                  다시 생성
                </button>
              </>
            ) : (
              <button type="button" disabled={!selected} onClick={() => generate(false)} className="flex h-14 items-center justify-center gap-2 rounded-[20px] bg-ink text-[16px] font-semibold text-inverse disabled:opacity-40" data-testid="generate">
                리포트 생성 <Arrow />
              </button>
            )}
          </div>
        </div>
      )}

      {view === "progress" && (
        <div className="flex flex-col gap-5 pt-4" data-testid="progress">
          <div>
            <h2 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">리포트를 만들고 있어요.</h2>
            <p className="mt-1 text-[16px] leading-6 text-secondary tabular">
              섹션별로 동시에 평가해요 · {Math.max(0, Math.round((now - startedAt) / 1000))}초 경과
            </p>
          </div>
          {steps.length === 0 && !error && (
            <p className="flex items-center gap-2 text-secondary">
              <Spinner /> 시작하는 중…
            </p>
          )}
          {GROUPS.map((g) => {
            const list = steps.filter((s) => s.group === g.id);
            if (!list.length) return null;
            const doneN = list.filter((s) => s.status === "done" || s.status === "skipped").length;
            return (
              <Card key={g.id} tone="surface" className="!p-4">
                <div className="flex items-center justify-between">
                  <H2 className="!text-[17px]">{g.label}</H2>
                  <span className="text-[13px] font-semibold text-secondary tabular">
                    {doneN}/{list.length}
                  </span>
                </div>
                <ul className="mt-2 flex flex-col gap-2">
                  {list.map((s) => (
                    <li key={s.id} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2" data-status={s.status}>
                      <span className="mt-0.5">
                        {s.status === "running" ? (
                          <Spinner />
                        ) : s.status === "done" ? (
                          <CheckIcon size={18} />
                        ) : s.status === "error" ? (
                          <span className="text-[15px] font-bold text-error">!</span>
                        ) : (
                          <span className="block h-[18px] w-[18px] rounded-full border-2 border-line" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-[15px] leading-[22px] ${s.status === "pending" ? "text-secondary" : ""}`}>{s.label}</span>
                        {s.detail && <span className={`block text-[13px] leading-5 ${s.status === "error" ? "text-error" : "text-secondary"}`}>{s.detail}</span>}
                      </span>
                      <span className="text-[12px] text-secondary tabular">{s.ms != null ? `${(s.ms / 1000).toFixed(1)}s` : ""}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          {error && (
            <Card tone="surface">
              <p className="text-[15px] leading-[22px] text-error" data-testid="error">{error}</p>
              <p className="mt-2 text-[13px] leading-5 text-secondary">미완성 결과는 저장하지 않아요. 점수는 모든 섹션이 평가된 리포트에만 매겨요.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setView("pick")} className="h-12 rounded-[20px] bg-canvas text-[15px] font-semibold">
                  세션 목록
                </button>
                <button type="button" onClick={() => generate(lastForce)} className="h-12 rounded-[20px] bg-ink text-[15px] font-semibold text-inverse">
                  {retryable ? "다시 시도" : "그래도 다시 시도"}
                </button>
              </div>
            </Card>
          )}
          <p className="text-[12px] leading-[18px] text-secondary">
            진행 상황은 다른 탭에서도 이어집니다. 같은 세션은 한 번만 계산되고 결과는 캐시돼요.
          </p>
        </div>
      )}

      {view === "result" && report && (
        <div className="pt-2">
          <ResultView
            report={report}
            onDetail={(t) => {
              setTab(t);
              setQaIndex(0);
              setView("detail");
            }}
          />
        </div>
      )}

      {view === "detail" && report && (
        <div className="flex flex-col gap-4 pt-2">
          {tab === "qa" && (
            <p className="sr-only" aria-live="polite">
              {qaHeadline(report.qa[qaIndex])}
            </p>
          )}
          <DetailView report={report} tab={tab} onTab={setTab} qaIndex={qaIndex} onQa={setQaIndex} />
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setView("result")} className="flex h-14 items-center justify-center gap-2 rounded-[20px] bg-ink text-[16px] font-semibold text-inverse">
              종합 결과로 <Arrow />
            </button>
            <button type="button" onClick={() => setView("pick")} className="h-11 text-[15px] font-medium text-secondary underline">
              다른 세션 선택
            </button>
          </div>
        </div>
      )}

      {(view === "result" || view === "detail") && !report && (
        <Card tone="surface" className="mt-6">
          <Label>리포트가 없어요</Label>
          <button type="button" onClick={() => setView("pick")} className="mt-3 h-12 w-full rounded-[20px] bg-ink text-inverse">
            세션 선택으로
          </button>
        </Card>
      )}
      {view === "pick" && sessions && sessions.length === 0 && <Pill>세션이 없어요</Pill>}
    </main>
  );
}
