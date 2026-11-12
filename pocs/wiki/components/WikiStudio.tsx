"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyLlmError } from "../lib/errors";
import { approxTokens } from "../lib/markdown";
import type { DocKind, DocMeta, KeyNumber, LintReport, QueryResult, WikiDocSummary, WikiPageInfo, WikiState, WikiStatus } from "../lib/types";
import { Markdown, type MdHandlers } from "./Markdown";

type Tab = "wiki" | "query" | "lint" | "log";
const TABS: { k: Tab; label: string }[] = [
  { k: "wiki", label: "위키" },
  { k: "query", label: "질의" },
  { k: "lint", label: "점검" },
  { k: "log", label: "log" },
];
const STATE_LABEL: Record<WikiState, string> = {
  queued: "대기",
  extracting: "추출",
  planning: "계획",
  merging: "병합",
  finalizing: "마무리",
  ready: "완료",
  error: "오류",
};
const KIND_LABEL: Record<DocKind, string> = { presentation: "발표자료", proposal: "제안자료" };
const STEPS: WikiState[] = ["extracting", "planning", "merging", "finalizing", "ready"];
const EXAMPLES = [
  "세트당 원가와 매출총이익률은?",
  "SOM(목표 시장)은 얼마이고 어떻게 산정했나?",
  "2027년 매출 목표의 근거와 생산능력은?",
  "원료는 어디서 조달하고 공급 리스크는?",
  "투자 요청 금액과 자금 사용 계획은?",
  "팀 구성과 핵심 인력은?",
];

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}
interface LoadedDoc {
  meta: DocMeta;
  status: WikiStatus;
  keyNumbers: KeyNumber[];
  pages: WikiPageInfo[];
}
async function fetchDoc(id: string): Promise<LoadedDoc> {
  const d = await j<Omit<LoadedDoc, "pages">>(`/api/wiki/docs/${id}`);
  const pages = d.status.state === "ready" ? await j<WikiPageInfo[]>(`/api/wiki/docs/${id}/pages`) : [];
  return { ...d, pages };
}
const fmtN = (n: number) => n.toLocaleString("ko-KR");
const sec = (ms?: number) => (ms == null ? "-" : `${(ms / 1000).toFixed(1)}초`);

export function WikiStudio() {
  const [docs, setDocs] = useState<WikiDocSummary[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [status, setStatus] = useState<WikiStatus | null>(null);
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [nums, setNums] = useState<KeyNumber[]>([]);
  const [pages, setPages] = useState<WikiPageInfo[]>([]);
  const [tab, setTab] = useState<Tab>("wiki");
  const [slug, setSlug] = useState("overview");
  const [pageMd, setPageMd] = useState<string | null>(null);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawView | null>(null);
  const [kind, setKind] = useState<DocKind | "auto">("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [docErr, setDocErr] = useState<string | null>(null); // reingest/delete errors, shown on the doc's card
  const [listOpen, setListOpen] = useState(true);
  const [rebuildTick, setRebuildTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Mobile: the viewer sits below the upload card, doc list and progress card (~1400px down), so after picking
  // a doc we scroll to what changed — the viewer when the wiki is ready, the progress card while it is building.
  // switching docs: drop the previous doc's page/raw view right away (not in an effect → no cascading render)
  const selectDoc = (id: string) => {
    if (id !== docId) {
      setDocErr(null);
      setPageMd(null);
      setPageErr(null);
      setRaw(null);
    }
    setDocId(id);
  };
  const reveal = useCallback((target: "viewer" | "progress") => {
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    setTimeout(() => (target === "viewer" ? viewerRef : progressRef).current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }, []);

  const refreshDocs = useCallback(() => j<WikiDocSummary[]>("/api/wiki/docs").then(setDocs).catch(() => {}), []);

  // initial: docs + URL state
  useEffect(() => {
    const u = new URL(window.location.href);
    const d = u.searchParams.get("doc");
    const t = u.searchParams.get("tab") as Tab | null;
    const p = u.searchParams.get("page");
    j<WikiDocSummary[]>("/api/wiki/docs")
      .catch(() => [] as WikiDocSummary[])
      .then((list) => {
        setDocs(list);
        setDocId(d && list.some((x) => x.docId === d) ? d : (list.find((x) => x.state === "ready")?.docId ?? list[0]?.docId ?? null));
        if (t && TABS.some((x) => x.k === t)) setTab(t);
        if (p) setSlug(p);
        setListOpen(window.matchMedia("(min-width: 1024px)").matches);
      });
  }, []);

  // keep URL in sync
  useEffect(() => {
    if (!docId) return;
    const u = new URL(window.location.href);
    u.searchParams.set("doc", docId);
    u.searchParams.set("tab", tab);
    if (tab === "wiki") u.searchParams.set("page", slug);
    else u.searchParams.delete("page");
    window.history.replaceState(null, "", u);
  }, [docId, tab, slug]);

  const applyDoc = useCallback((d: LoadedDoc) => {
    setMeta(d.meta);
    setStatus(d.status);
    setNums(d.keyNumbers);
    setPages(d.pages);
    return d.status;
  }, []);
  const loadDoc = useCallback((id: string) => fetchDoc(id).then(applyDoc), [applyDoc]);

  // selected doc: load + live progress via SSE
  useEffect(() => {
    if (!docId) return;
    let es: EventSource | null = null;
    let alive = true;
    fetchDoc(docId)
      .then((d) => {
        if (!alive) return;
        const st = applyDoc(d);
        if (!alive || (st.state === "ready" && !st.rebuild) || st.state === "error") return;
        es = new EventSource(`/api/wiki/docs/${docId}/events`);
        es.onmessage = (ev) => {
          const s = JSON.parse(ev.data) as WikiStatus | null;
          if (!s || !alive) return;
          setStatus(s);
          if ((s.state === "ready" && !s.rebuild) || s.state === "error") {
            es?.close();
            void loadDoc(docId);
            void refreshDocs();
          }
        };
        es.onerror = () => {
          es?.close();
          if (alive) setTimeout(() => alive && loadDoc(docId), 1500);
        };
      })
      .catch((e) => setErr(String(e.message ?? e)));
    return () => {
      alive = false;
      es?.close();
    };
  }, [docId, applyDoc, loadDoc, refreshDocs, rebuildTick]);

  // page content
  // status/meta still hold the previous doc for a moment after docId changes → only trust them if they match
  const ready = status?.state === "ready" && status.docId === docId;
  const metaOk = meta && meta.docId === docId ? meta : null;
  useEffect(() => {
    if (!docId || !ready || (tab !== "wiki" && tab !== "log")) return;
    const s = tab === "log" ? "log" : slug;
    let alive = true;
    fetch(`/api/wiki/docs/${docId}/pages/${encodeURIComponent(s)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? `[[${s}]] 페이지가 없습니다` : `HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (!alive) return;
        setPageMd(t);
        setPageErr(null);
      })
      .catch((e) => alive && (setPageMd(null), setPageErr(String(e.message))));
    return () => {
      alive = false;
    };
  }, [docId, ready, tab, slug, status?.updatedAt]);

  const openRaw = useCallback(
    async (page: number, group?: number[]) => {
      if (!docId) return;
      setRaw((prev) => {
        // stepping inside the same citation keeps its group; a new citation replaces it
        const g = group && group.length > 1 ? group : group ? undefined : prev?.group?.includes(page) ? prev.group : undefined;
        return { page, group: g, text: null };
      });
      const r = await fetch(`/api/wiki/docs/${docId}/raw/${page}`);
      const text = r.ok ? await r.text() : "(이 쪽을 찾을 수 없습니다)";
      setRaw((prev) => (prev && prev.page === page ? { ...prev, text } : prev));
    },
    [docId],
  );
  const knownSlugs = useMemo(() => new Set(pages.map((p) => p.slug)), [pages]);
  const handlers: MdHandlers = useMemo(
    () => ({
      knownSlugs,
      onCite: openRaw,
      onLink: (s) => {
        setTab("wiki");
        setSlug(s === "schema" ? "SCHEMA" : s);
        viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    }),
    [knownSlugs, openRaw],
  );

  async function ingest(body: { sample: string } | File) {
    setErr(null);
    setBusy(body instanceof File ? body.name : body.sample);
    try {
      let r: { docId: string; reused: boolean };
      if (body instanceof File) {
        const fd = new FormData();
        fd.set("file", body);
        if (kind !== "auto") fd.set("kind", kind);
        r = await j("/api/wiki/ingest", { method: "POST", body: fd });
      } else r = await j("/api/wiki/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await refreshDocs();
      setSlug("overview");
      setTab("wiki");
      selectDoc(r.docId);
      if (r.docId === docId) void loadDoc(r.docId);
      reveal(r.reused ? "viewer" : "progress");
    } catch (e) {
      setErr(friendlyLlmError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-[var(--gutter)] pb-24">
      <header className="sticky top-0 z-20 -mx-[var(--gutter)] flex h-14 items-center gap-2 border-b border-line bg-canvas/95 px-[var(--gutter)] backdrop-blur">
        <Link href="/" aria-label="PoC 허브로" className="-ml-2 grid h-11 w-11 place-items-center rounded-full hover:bg-surface">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="flex-1 truncate text-[16px] font-semibold">Context to Wiki</h1>
        <span className="text-[12px] text-secondary">LLM Wiki · PoC</span>
      </header>

      <section className="pt-6">
        <h2 className="text-[28px] font-bold leading-[36px] tracking-[-0.8px]">자료를 위키로</h2>
        <p className="mt-2 text-[15px] leading-[23px] text-secondary">
          PDF를 쪽 단위로 읽어 서로 링크된 위키 페이지로 정리합니다. 질문·리포트는 PDF 전체 대신 필요한 페이지만 출처와 함께 가져다 씁니다.
        </p>
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        {/* ---------------- left column ---------------- */}
        <div className="space-y-4 lg:sticky lg:top-20">
          <div className="rounded-[28px] bg-surface p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[17px] font-semibold">PDF 올리기</h3>
              <div className="flex gap-1" role="radiogroup" aria-label="자료 종류">
                {(["auto", "presentation", "proposal"] as const).map((k) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={`h-8 rounded-full px-3 text-[13px] font-medium ${kind === k ? "bg-ink text-inverse" : "bg-canvas text-ink"}`}
                  >
                    {k === "auto" ? "자동" : KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void ingest(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-ink text-[16px] font-semibold text-inverse disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
              </svg>
              {busy && !["presentation", "proposal", "large"].includes(busy) ? "올리는 중…" : "PDF 선택"}
            </button>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { s: "presentation", l: "샘플: 발표자료", d: "12쪽" },
                { s: "proposal", l: "샘플: 제안자료", d: "58쪽" },
                { s: "large", l: "대용량 합본", d: "128쪽" },
              ].map((x) => (
                <button
                  key={x.s}
                  onClick={() => ingest({ sample: x.s })}
                  disabled={!!busy}
                  className="flex min-h-[52px] flex-col items-center justify-center rounded-[16px] bg-canvas px-2 py-2 text-[13px] font-semibold leading-[18px] disabled:opacity-50"
                >
                  <span>{busy === x.s ? "시작 중…" : x.l}</span>
                  <span className="text-[12px] font-normal text-secondary">{x.d}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-[18px] text-secondary">같은 PDF는 내용 해시로 같은 위키를 재사용합니다. 텍스트가 없는 스캔 PDF는 지원하지 않습니다.</p>
            {err && (
              <p role="alert" className="mt-3 rounded-[16px] bg-canvas px-4 py-3 text-[14px] text-error">
                {err}
              </p>
            )}
          </div>

          {docs.length > 0 && (
            <div>
              <h3 className="mb-2 px-1 text-[14px] font-medium text-secondary">위키 목록 {docs.length}</h3>
              <ul className="space-y-2">
                {docs.map((d) => (
                  <li key={d.docId}>
                    <button
                      onClick={() => {
                        setSlug("overview");
                        selectDoc(d.docId);
                        reveal(d.state === "ready" ? "viewer" : "progress");
                      }}
                      aria-current={d.docId === docId}
                      className={`flex w-full items-center gap-3 rounded-[20px] px-4 py-3 text-left ${d.docId === docId ? "bg-ink text-inverse" : "bg-surface"}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{d.filename}</span>
                        <span className={`block text-[12px] tabular ${d.docId === docId ? "text-inverse/70" : "text-secondary"}`}>
                          {d.state === "error" && !d.pageCount ? friendlyLlmError(d.error ?? "오류") : `${KIND_LABEL[d.kind]} · ${d.pageCount}쪽 · ${fmtN(d.chars)}자 · 위키 ${d.wikiPages}p`}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${d.docId === docId ? "bg-canvas text-ink" : d.state === "error" ? "bg-canvas text-error" : "bg-canvas text-ink"}`}>
                        {d.rebuilding ? "재생성 중" : STATE_LABEL[d.state]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status && status.docId === docId && (
            <div ref={progressRef} className="scroll-mt-16">
            <Progress
              status={status}
              onRebuild={async () => {
                const msg =
                  status.state === "ready"
                    ? "이 문서의 위키를 원본 PDF에서 처음부터 다시 만들까요?\n\n새 위키가 다 만들어질 때까지 지금 위키는 그대로 보이고 질의·점검에도 계속 쓰입니다. 다시 만들기가 실패하면 지금 위키를 그대로 유지합니다. (LLM 호출 비용 발생)"
                    : "원본 PDF에서 위키 만들기를 다시 시도할까요? (LLM 호출 비용 발생)";
                if (!docId || !confirm(msg)) return;
                setDocErr(null);
                try {
                  await j(`/api/wiki/docs/${docId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reingest" }) });
                  setRebuildTick((n) => n + 1);
                  void refreshDocs();
                } catch (e) {
                  setDocErr(friendlyLlmError(e));
                  reveal("progress");
                }
              }}
              onDelete={async () => {
                if (!docId || !confirm(`‘${status.filename}’ 문서와 위키(원본 PDF·페이지·점검 결과·기록)를 삭제할까요? 되돌릴 수 없습니다.`)) return;
                setDocErr(null);
                try {
                  await j(`/api/wiki/docs/${docId}`, { method: "DELETE" });
                  const list = await j<WikiDocSummary[]>("/api/wiki/docs");
                  setDocs(list);
                  setStatus(null);
                  setMeta(null);
                  setPages([]);
                  setSlug("overview");
                  const next = list.find((x) => x.state === "ready")?.docId ?? list[0]?.docId ?? null;
                  if (next) selectDoc(next);
                  else setDocId(null);
                } catch (e) {
                  setDocErr(friendlyLlmError(e));
                }
              }}
              error={docErr}
            />
            </div>
          )}

          {ready && tab === "wiki" && pages.length > 0 && (
            <div className="rounded-[28px] bg-surface p-2">
              <button
                onClick={() => setListOpen((v) => !v)}
                aria-expanded={listOpen}
                className="flex h-11 w-full items-center justify-between rounded-[20px] px-3 text-[15px] font-semibold"
              >
                <span>
                  페이지 <span className="tabular text-secondary">{pages.length}</span>
                </span>
                <span className="text-[13px] font-normal text-secondary">{listOpen ? "접기" : "펼치기"}</span>
              </button>
              {listOpen && (
                <ul className="max-h-[52vh] overflow-y-auto pb-1 lg:max-h-[calc(100vh-420px)]">
                  {[{ slug: "index", title: "index", summary: "모든 페이지 카탈로그", sources: [] as number[] } as Partial<WikiPageInfo>, ...pages, { slug: "SCHEMA", title: "SCHEMA", summary: "위키 규칙", sources: [] }].map((p) => (
                    <li key={p.slug}>
                      <button
                        onClick={() => {
                          setSlug(p.slug!);
                          if (!window.matchMedia("(min-width: 1024px)").matches) viewerRef.current?.scrollIntoView({ behavior: "smooth" });
                        }}
                        aria-current={slug === p.slug}
                        className={`w-full rounded-[16px] px-3 py-2 text-left ${slug === p.slug ? "bg-canvas" : "hover:bg-canvas/60"}`}
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-[14px] font-semibold">{p.title}</span>
                          {p.type && p.type !== "topic" && <span className="shrink-0 text-[11px] text-secondary">{p.type}</span>}
                        </span>
                        {p.summary && <span className="line-clamp-1 text-[12px] leading-[18px] text-secondary">{p.summary}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ---------------- right column ---------------- */}
        <div ref={viewerRef} className="min-w-0 scroll-mt-16">
          {!docId && <Empty />}
          {docId && (
            <>
              <div role="tablist" aria-label="보기" className="flex gap-1 rounded-full bg-surface p-1">
                {TABS.map((t) => (
                  <button
                    key={t.k}
                    role="tab"
                    aria-selected={tab === t.k}
                    onClick={() => setTab(t.k)}
                    className={`h-10 flex-1 rounded-full text-[14px] font-semibold ${tab === t.k ? "bg-ink text-inverse" : "text-ink"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {!ready && (
                <p className="mt-6 rounded-[20px] bg-surface px-5 py-6 text-[15px] text-secondary">
                  {status?.state === "error"
                    ? `위키를 만들지 못했습니다. ${friendlyLlmError(status.error ?? "")} 준비되면 인제스트 카드의 ‘다시 시도’를 누르세요.`
                    : "위키를 만드는 중입니다. 인제스트 진행 카드(모바일은 위, 데스크톱은 왼쪽)에서 청크·라운드별로 페이지가 생기는 것을 볼 수 있습니다."}
                </p>
              )}
              {ready && tab === "wiki" && (
                <article className="mt-5" aria-live="polite">
                  <div className="mb-3 flex items-center gap-2 text-[12px] text-secondary">
                    <span className="truncate">{metaOk?.filename}</span>
                    <span>/</span>
                    <span className="font-medium text-ink">{slug}</span>
                  </div>
                  {pageErr && <p className="rounded-[20px] bg-surface px-5 py-4 text-[14px] text-error">{pageErr}</p>}
                  {pageMd ? <Markdown md={pageMd} h={handlers} /> : !pageErr && <Skeleton />}
                  {slug === "주요-수치" && nums.some((n) => n.conflict) && (
                    <p className="mt-4 text-[13px] text-secondary">⚠ 표시는 문서 안에서 같은 항목의 값이 서로 다른 경우입니다.</p>
                  )}
                </article>
              )}
              {ready && tab === "log" && <article className="mt-5">{pageMd ? <Markdown md={pageMd} h={handlers} compact /> : <Skeleton />}</article>}
              {/* kept mounted (hidden) across tab switches so a query result survives following a page chip; keyed by doc */}
              {ready && docId && metaOk && (
                <div hidden={tab !== "query"}>
                  <QueryPanel key={docId} docId={docId} meta={metaOk} h={handlers} />
                </div>
              )}
              {ready && tab === "lint" && docId && <LintPanel key={docId} docId={docId} docs={docs} h={handlers} />}
            </>
          )}
        </div>
      </div>

      {raw && <RawSheet raw={raw} pageCount={metaOk?.pageCount ?? 0} docId={docId!} onClose={() => setRaw(null)} onGo={openRaw} />}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-[28px] bg-surface px-6 py-10 text-center">
      <p className="text-[17px] font-semibold">아직 위키가 없습니다</p>
      <p className="mt-2 text-[14px] text-secondary">PDF를 올리거나 샘플 버튼을 눌러 시작하세요.</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-7 w-1/2 animate-pulse rounded-lg bg-surface" />
      <div className="h-16 animate-pulse rounded-[16px] bg-surface" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-surface" />
      <div className="h-4 w-4/6 animate-pulse rounded bg-surface" />
    </div>
  );
}

function Progress({ status: cur, onRebuild, onDelete, error }: { status: WikiStatus; onRebuild: () => void; onDelete: () => void; error: string | null }) {
  // while a ready wiki is rebuilt, the card follows the NEW build; the current wiki stays usable
  const s = cur.rebuild ?? cur;
  const rebuilding = !!cur.rebuild;
  const [now, setNow] = useState(() => Date.now());
  const live = s.state !== "ready" && s.state !== "error";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const tokens = Object.values(s.usage).reduce((a, u) => ({ i: a.i + u.inputTokens, o: a.o + u.outputTokens, c: a.c + u.calls }), { i: 0, o: 0, c: 0 });
  const elapsed = live ? now - Date.parse(s.startedAt) : s.timings.total;
  const stepIdx = STEPS.indexOf(s.state);
  return (
    <div className="rounded-[28px] border border-line p-5" aria-live="polite">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[17px] font-semibold">{rebuilding ? "위키 다시 만드는 중" : "인제스트"}</h3>
        <span className={`text-[13px] font-medium tabular ${s.state === "error" ? "text-error" : "text-secondary"}`}>
          {STATE_LABEL[s.state]} · {sec(elapsed)}
        </span>
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-1" aria-label="단계">
        {STEPS.slice(0, 4).map((st, i) => (
          <li key={st} className="text-center">
            <div className={`h-1.5 rounded-full ${s.state === "ready" || i < stepIdx ? "bg-ink" : i === stepIdx ? "animate-pulse bg-ink/50" : "bg-line"}`} />
            <span className={`mt-1 block text-[12px] ${i <= stepIdx || s.state === "ready" ? "text-ink" : "text-secondary"}`}>{STATE_LABEL[st]}</span>
          </li>
        ))}
      </ol>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] tabular">
        <dt className="text-secondary">청크 추출</dt>
        <dd className="text-right font-medium">
          {s.chunksDone}/{s.chunksTotal || "-"}
        </dd>
        <dt className="text-secondary">병합 라운드</dt>
        <dd className="text-right font-medium">
          {s.roundsDone}/{s.roundsTotal || "-"}
        </dd>
        <dt className="text-secondary">페이지 생성 · 갱신</dt>
        <dd className="text-right font-medium">
          {s.pagesCreated} · {s.pagesUpdated}
        </dd>
        <dt className="text-secondary">원문</dt>
        <dd className="text-right font-medium">{s.pageCount ? `${s.pageCount}쪽` : "-"}</dd>
        <dt className="text-secondary">LLM 호출 · 토큰</dt>
        <dd className="text-right font-medium">
          {tokens.c}회 · {fmtN(tokens.i)}/{fmtN(tokens.o)}
        </dd>
      </dl>
      {s.provider && <p className="mt-2 truncate text-[11px] text-secondary">provider: {s.provider}</p>}
      {rebuilding && (
        <p className="mt-3 rounded-[16px] bg-surface px-4 py-3 text-[13px] leading-[19px] text-secondary">
          새 위키가 다 만들어질 때까지 지금 위키를 그대로 보고 질의할 수 있습니다. 실패하면 지금 위키가 유지됩니다.
        </p>
      )}
      {!rebuilding && cur.lastReingestError && (
        <p role="status" className="mt-3 rounded-[16px] bg-surface px-4 py-3 text-[13px] leading-[19px]">
          <span className="font-semibold text-error">마지막 다시 만들기 실패</span>
          {cur.lastReingestAt && <span className="tabular text-secondary"> · {new Date(cur.lastReingestAt).toLocaleString("ko-KR", { hour12: false })}</span>}
          <span className="mt-1 block text-secondary">{friendlyLlmError(cur.lastReingestError)} 지금 보이는 위키는 이전 버전 그대로입니다.</span>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-[16px] bg-surface px-4 py-3 text-[13px] leading-[19px] text-error">
          {error}
        </p>
      )}
      {!live && (
        <div className="mt-3 flex gap-2">
          <button onClick={onRebuild} className="h-11 flex-1 rounded-[16px] bg-surface text-[14px] font-semibold">
            {s.state === "error" ? "다시 시도" : "위키 다시 만들기"}
          </button>
          <button onClick={onDelete} aria-label="이 문서 삭제" className="h-11 rounded-[16px] bg-surface px-4 text-[14px] font-semibold text-error">
            삭제
          </button>
        </div>
      )}
      <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-line pt-3 text-[12px] leading-[17px]">
        {[...s.events].reverse().slice(0, 12).map((e, i) => (
          <li key={i} className={i === 0 ? "text-ink" : "text-secondary"}>
            <span className="tabular">{new Date(e.ts).toLocaleTimeString("ko-KR", { hour12: false })}</span> {e.msg.startsWith("실패: ") ? `실패: ${friendlyLlmError(e.msg.slice(4))}` : e.msg}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueryPanel({ docId, meta, h }: { docId: string; meta: DocMeta; h: MdHandlers }) {
  const [q, setQ] = useState("");
  const [budget, setBudget] = useState(6000);
  const [answer, setAnswer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCtx, setShowCtx] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function run(query: string) {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      setRes(
        await j<QueryResult>(`/api/wiki/docs/${docId}/query`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, maxContextChars: budget, answer }),
        }),
      );
    } catch (e) {
      setErr(friendlyLlmError(e));
    } finally {
      setBusy(false);
    }
  }
  // files exactly the answer shown on screen (no second LLM call)
  async function save(r: QueryResult) {
    if (!r.answer) return;
    setSaving(true);
    setErr(null);
    try {
      const { savedAs } = await j<{ savedAs: string }>(`/api/wiki/docs/${docId}/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: r.query, answer: r.answer, pages: r.pages }),
      });
      setSaved(savedAs);
    } catch (e) {
      setErr(friendlyLlmError(e));
    } finally {
      setSaving(false);
    }
  }
  const ratio = res ? res.contextChars / res.fullTextChars : 0;
  return (
    <div className="mt-5 space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
        }}
        className="rounded-[28px] bg-surface p-5"
      >
        <label htmlFor="wiki-q" className="text-[14px] font-medium">
          질문 (심사위원·리포트가 쓰는 컨텍스트 API와 동일)
        </label>
        <textarea
          id="wiki-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          rows={2}
          placeholder="예: 세트당 원가와 매출총이익률은?"
          className="mt-2 min-h-[52px] w-full resize-y rounded-[16px] border border-line bg-canvas px-4 py-3 text-[16px] outline-none focus:border-ink"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void run(q);
            }
          }}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <button
              type="button"
              key={x}
              onClick={() => {
                setQ(x);
                void run(x);
              }}
              className="rounded-full bg-canvas px-3 py-1.5 text-[13px]"
            >
              {x}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex flex-1 items-center gap-3 text-[13px]">
            <span className="shrink-0 text-secondary">컨텍스트 예산</span>
            <input type="range" min={1500} max={16000} step={500} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="min-w-0 flex-1 accent-[#111]" />
            <span className="w-[64px] shrink-0 text-right font-semibold tabular">{fmtN(budget)}자</span>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={answer} onChange={(e) => setAnswer(e.target.checked)} className="h-5 w-5 accent-[#111]" />
            답변 생성
          </label>
        </div>
        <button type="submit" disabled={busy || !q.trim()} className="mt-4 h-14 w-full rounded-[20px] bg-ink text-[16px] font-semibold text-inverse disabled:opacity-40">
          {busy ? "검색 중…" : "질의"}
        </button>
      </form>

      {err && <p className="rounded-[20px] bg-surface px-5 py-4 text-[14px] text-error">{err}</p>}

      {res && (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-line p-5">
            <h3 className="text-[15px] font-semibold">선택된 페이지</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {res.pages.map((p) => (
                <button key={p} onClick={() => h.onLink?.(p)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${res.selected.includes(p) ? "bg-ink text-inverse" : "border border-line"}`}>
                  {p}
                  {!res.selected.includes(p) && <span className="ml-1 text-secondary">+링크</span>}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-secondary">
              선택기 {res.selector === "llm" ? "LLM(index 기반)" : "어휘 매칭(폴백)"} · 선택 {sec(res.timings.selectMs)}
              {res.timings.answerMs != null && ` · 답변 ${sec(res.timings.answerMs)}`} · 전체 {sec(res.timings.totalMs)}
            </p>
            {res.selectError && <p className="mt-1 text-[12px] leading-[17px] text-secondary">{res.selectError}</p>}
            <div className="mt-4">
              <div className="flex justify-between text-[13px] tabular">
                <span>
                  컨텍스트 <b>{fmtN(res.contextChars)}자</b> ≈ {fmtN(res.approxTokens.context)} tok
                </span>
                <span className="text-secondary">
                  전문 {fmtN(res.fullTextChars)}자 ≈ {fmtN(res.approxTokens.fullText)} tok
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={`전문 대비 ${(ratio * 100).toFixed(1)}%`}>
                <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(1, Math.min(100, ratio * 100))}%` }} />
              </div>
              <p className="mt-1 text-[12px] text-secondary tabular">
                {res.mode === "raw+wiki"
                  ? `소형 문서: 원문 전체 + 주요 수치 요약 (전문 대비 ${(ratio * 100).toFixed(0)}%, ${meta.pageCount}쪽 PDF)`
                  : `전문 대비 ${(ratio * 100).toFixed(1)}% (${meta.pageCount}쪽 PDF)${res.truncated ? " · 일부 섹션 생략됨" : ""}`}
              </p>
            </div>
          </div>

          {res.answerError && (
            <div role="alert" className="rounded-[28px] bg-surface p-5">
              <h3 className="text-[15px] font-semibold">답변을 만들지 못했습니다</h3>
              <p className="mt-2 break-keep text-[14px] leading-[21px] text-error">{res.answerError}</p>
              <p className="mt-2 text-[13px] leading-[19px] text-secondary">선택된 페이지와 아래 컨텍스트는 정상입니다. 심사위원·리포트는 이 컨텍스트를 그대로 사용합니다.</p>
            </div>
          )}
          {res.answer && (
            <div className="rounded-[28px] bg-surface p-5">
              <h3 className="text-[15px] font-semibold">답변</h3>
              <div className="mt-2">
                <Markdown md={res.answer} h={h} compact />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-secondary">
                인용 쪽:
                {res.citations.length ? res.citations.map((c) => (
                  <button key={c} onClick={() => h.onCite?.(c, res.citations)} className="rounded-full bg-canvas px-2 py-0.5 font-medium text-ink tabular">
                    p.{c}
                  </button>
                )) : " 없음"}
              </div>
              <button onClick={() => save(res)} disabled={busy || saving || !!saved} className="mt-4 h-11 rounded-[16px] bg-canvas px-4 text-[14px] font-semibold disabled:opacity-50">
                {saved ? "위키에 저장됨" : saving ? "저장 중…" : "이 답변을 위키 페이지로 저장"}
              </button>
              {saved && (
                <button onClick={() => h.onLink?.(saved)} className="ml-2 text-[14px] font-semibold underline underline-offset-4">
                  [[{saved}]] 열기
                </button>
              )}
            </div>
          )}

          <div className="rounded-[28px] border border-line">
            <button onClick={() => setShowCtx((v) => !v)} aria-expanded={showCtx} className="flex h-14 w-full items-center justify-between px-5 text-[15px] font-semibold">
              전달되는 컨텍스트 ({fmtN(res.contextChars)}자 · ≈{fmtN(approxTokens(res.contextChars))} tok)
              <span className="text-[13px] font-normal text-secondary">{showCtx ? "접기" : "펼치기"}</span>
            </button>
            {showCtx && (
              <div className="border-t border-line px-5 py-4">
                <Markdown md={res.context} h={h} compact />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const SEV_LABEL = { high: "높음", medium: "중간", low: "낮음" } as const;
const TYPE_LABEL: Record<string, string> = {
  contradiction: "모순",
  "cross-doc-mismatch": "문서 간 불일치",
  orphan: "고아 페이지",
  "broken-link": "깨진 링크",
  "missing-citation": "출처 누락",
  "bad-citation": "잘못된 출처",
  gap: "자료 공백",
  "missing-page": "페이지 없음",
  stale: "오래된 주장",
};

function LintPanel({ docId, docs, h }: { docId: string; docs: WikiDocSummary[]; h: MdHandlers }) {
  const others = docs.filter((d) => d.docId !== docId && d.state === "ready");
  const [against, setAgainst] = useState<string>("");
  const [rep, setRep] = useState<LintReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/wiki/docs/${docId}/lint${against ? `?against=${against}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => alive && setRep(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [docId, against]);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      setRep(await j<LintReport>(`/api/wiki/docs/${docId}/lint`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ against: against || undefined }) }));
    } catch (e) {
      setErr(friendlyLlmError(e));
    } finally {
      setBusy(false);
    }
  }
  const otherName = docs.find((d) => d.docId === against)?.filename;
  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-[28px] bg-surface p-5">
        <h3 className="text-[15px] font-semibold">LINT — 위키 건강 점검</h3>
        <p className="mt-1 text-[13px] leading-[19px] text-secondary">모순, 고아 페이지, 깨진 링크, 출처 누락, 자료 공백을 찾습니다. 비교 문서를 고르면 두 자료 사이의 수치 불일치도 찾습니다.</p>
        <label className="mt-4 block text-[13px] font-medium" htmlFor="lint-against">
          비교 문서
        </label>
        <select
          id="lint-against"
          value={against}
          onChange={(e) => setAgainst(e.target.value)}
          className="mt-1 h-[52px] w-full rounded-[16px] border border-line bg-canvas px-4 text-[15px]"
        >
          <option value="">없음 (이 문서만 점검)</option>
          {others.map((d) => (
            <option key={d.docId} value={d.docId}>
              {d.filename} · {KIND_LABEL[d.kind]} {d.pageCount}쪽
            </option>
          ))}
        </select>
        <button onClick={run} disabled={busy} className="mt-4 h-14 w-full rounded-[20px] bg-ink text-[16px] font-semibold text-inverse disabled:opacity-40">
          {busy ? "점검 중…" : "점검 실행"}
        </button>
      </div>
      {err && <p className="rounded-[20px] bg-surface px-5 py-4 text-[14px] text-error">{err}</p>}
      {rep && (
        <div>
          <p className="px-1 text-[13px] text-secondary tabular">
            이슈 {rep.issues.length}건 · {sec(rep.ms)} · {new Date(rep.checkedAt).toLocaleString("ko-KR")}
            {otherName && ` · 비교: ${otherName}`}
          </p>
          {rep.llmError && <p role="alert" className="mt-2 rounded-[16px] bg-surface px-4 py-3 text-[13px] leading-[19px] text-error">{rep.llmError} 아래는 결정적 점검(링크·고아·출처) 결과만입니다.</p>}
          <ul className="mt-2 space-y-2">
            {rep.issues.map((i, k) => (
              <li key={k} className="rounded-[20px] border border-line p-4">
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${i.severity === "high" ? "bg-ink text-inverse" : "bg-surface"}`}>{SEV_LABEL[i.severity]}</span>
                  <span className="rounded-full bg-surface px-2 py-0.5 font-medium">{TYPE_LABEL[i.type] ?? i.type}</span>
                  {i.pages.map((p) => (
                    <button key={p} onClick={() => h.onLink?.(p)} className="font-semibold underline underline-offset-2">
                      [[{p}]]
                    </button>
                  ))}
                </div>
                <p className="mt-2 break-keep text-[14px] leading-[21px]">{i.message}</p>
                {(i.citations.length > 0 || (i.otherCitations?.length ?? 0) > 0) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-secondary">
                    {i.citations.length > 0 && "이 문서"}
                    {i.citations.map((c) => (
                      <button key={c} onClick={() => h.onCite?.(c, i.citations)} className="rounded-full bg-surface px-2 py-0.5 font-medium text-ink tabular">
                        p.{c}
                      </button>
                    ))}
                    {(i.otherCitations?.length ?? 0) > 0 && <span className="ml-2">비교 문서 p.{i.otherCitations!.join(", p.")}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RawView {
  page: number;
  /** all pages of the citation that was clicked; ‹ › then step through these instead of adjacent pages */
  group?: number[];
  text: string | null;
}

function RawSheet({ raw, pageCount, docId, onClose, onGo }: { raw: RawView; pageCount: number; docId: string; onClose: () => void; onGo: (p: number, group?: number[]) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const g = raw.group;
  const gi = g ? g.indexOf(raw.page) : -1;
  const prev = g ? (gi > 0 ? g[gi - 1] : null) : raw.page > 1 ? raw.page - 1 : null;
  const next = g ? (gi >= 0 && gi < g.length - 1 ? g[gi + 1] : null) : raw.page < pageCount ? raw.page + 1 : null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 lg:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`원문 ${raw.page}쪽`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[640px] flex-col rounded-t-[28px] bg-canvas lg:rounded-[28px]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-secondary">{g ? `이 인용의 출처 ${gi + 1}/${g.length}` : "raw · 불변 원문(추출 텍스트)"}</p>
            <p className="text-[17px] font-semibold tabular">
              p.{raw.page} <span className="text-[13px] font-normal text-secondary">/ {pageCount}</span>
            </p>
          </div>
          <button aria-label={g ? "이전 출처 쪽" : "이전 쪽"} disabled={prev == null} onClick={() => prev != null && onGo(prev)} className="grid h-11 w-11 place-items-center rounded-full bg-surface disabled:opacity-30">
            ‹
          </button>
          <button aria-label={g ? "다음 출처 쪽" : "다음 쪽"} disabled={next == null} onClick={() => next != null && onGo(next)} className="grid h-11 w-11 place-items-center rounded-full bg-surface disabled:opacity-30">
            ›
          </button>
          <button aria-label="닫기" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-ink text-inverse">
            ✕
          </button>
        </div>
        {g && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-5 py-2.5" role="tablist" aria-label="인용된 쪽">
            {g.map((n) => (
              <button
                key={n}
                role="tab"
                aria-selected={n === raw.page}
                onClick={() => onGo(n)}
                className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold tabular ${n === raw.page ? "bg-ink text-inverse" : "bg-surface text-ink"}`}
              >
                p.{n}
              </button>
            ))}
          </div>
        )}
        <pre className="flex-1 overflow-y-auto whitespace-pre-wrap break-keep px-5 py-4 font-sans text-[14px] leading-[22px]">{raw.text ?? "불러오는 중…"}</pre>
        <div className="border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <a href={`/api/wiki/docs/${docId}/pdf#page=${raw.page}`} target="_blank" rel="noreferrer" className="text-[14px] font-semibold underline underline-offset-4">
            PDF에서 {raw.page}쪽 열기
          </a>
        </div>
      </div>
    </div>
  );
}
