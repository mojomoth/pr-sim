"use client";
// Citation links for the report: every document page ref opens that PDF page in a sheet, every transcript ref
// (sentenceId, or "[12]" in LLM text) opens the transcript at that utterance with its time and text highlighted.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Dialog } from "@/components/Dialog";
import { getBlob } from "@/features/session/db";
import type { DocRole, SessionRecord, TranscriptSentence } from "@/features/session/types";
import { mmss } from "@/features/session/useCountdown";
import { SlideViewer } from "@/features/slide/SlideViewer";
import { DOC_LABEL, type DocRef } from "@/server/report/types";

type Open = { kind: "page"; doc: DocRole; page: number; quote?: string | null } | { kind: "sentence"; ids: string[] };

interface Cite {
  open: (o: Open) => void;
  sentence: (id: string) => TranscriptSentence | undefined;
  /** Sentence i of the presentation transcript sorted by time: what "[i]" means in report text (server report/generate.ts). */
  numbered: (i: number) => TranscriptSentence | undefined;
}

const CiteContext = createContext<Cite | null>(null);

function useCite(): Cite {
  const c = useContext(CiteContext);
  if (!c) throw new Error("CiteProvider missing");
  return c;
}

const PHASE_LABEL = { presentation: "발표", qa: "질의응답" } as const;

/** "발표 01:23" — t is seconds since that phase started. */
export function stampOf(s: TranscriptSentence): string {
  return `${PHASE_LABEL[s.phase]} ${mmss(Math.floor(s.t))}`;
}

export function CiteProvider({ session, children }: { session: SessionRecord; children: React.ReactNode }) {
  const [opened, setOpened] = useState<Open | null>(null);
  const value = useMemo<Cite>(() => {
    const byId = new Map(session.transcript.map((s) => [s.id, s]));
    const order = session.transcript.filter((s) => s.phase === "presentation").sort((a, b) => a.t - b.t);
    return { open: setOpened, sentence: (id) => byId.get(id), numbered: (i) => order[i] };
  }, [session.transcript]);
  const close = useCallback(() => setOpened(null), []);
  return (
    <CiteContext.Provider value={value}>
      {children}
      {opened?.kind === "page" && <PageSheet session={session} doc={opened.doc} page={opened.page} quote={opened.quote} onClose={close} />}
      {opened?.kind === "sentence" && <TranscriptSheet transcript={session.transcript} ids={opened.ids} onClose={close} />}
    </CiteContext.Provider>
  );
}

const chip = "inline-flex min-h-8 items-center rounded-full border px-2.5 text-[13px] font-semibold tabular transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** "제안자료 p.34" chips (dashed = page not confirmed in the raw text). */
export function DocRefChips({ refs, max = 4 }: { refs: DocRef[]; max?: number }) {
  const { open } = useCite();
  const seen = new Set<string>();
  const items = refs
    .flatMap((r) => r.pages.slice(0, max).map((page) => ({ doc: r.doc, page, quote: r.quote, grounded: r.grounded !== false })))
    .filter((i) => {
      const k = `${i.doc}:${i.page}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (!items.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <PageLink key={`${i.doc}:${i.page}`} doc={i.doc} page={i.page} quote={i.quote} grounded={i.grounded} onOpen={open} />
      ))}
    </span>
  );
}

function PageLink({ doc, page, quote, grounded, onOpen, label }: { doc: DocRole; page: number; quote?: string | null; grounded: boolean; onOpen: Cite["open"]; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onOpen({ kind: "page", doc, page, quote })}
      className={`${chip} ${grounded ? "border-line bg-canvas text-ink" : "border-dashed border-secondary text-secondary"}`}
      aria-label={`${DOC_LABEL[doc]} ${page}쪽 보기${grounded ? "" : " (원문에서 값을 찾지 못한 인용)"}`}
    >
      {label ?? `${DOC_LABEL[doc]} p.${page}`}
    </button>
  );
}

/** Single page link with a custom label (coverage rows, consistency table). */
export function PageRef({ doc, page, label }: { doc: DocRole; page: number; label?: string }) {
  const { open } = useCite();
  return <PageLink doc={doc} page={page} grounded onOpen={open} label={label} />;
}

/** Clickable utterance time ("발표 01:23"), optionally followed by its text. Unknown ids render nothing. */
export function SentenceRef({ id, withText }: { id: string; withText?: boolean }) {
  const { open, sentence } = useCite();
  const s = sentence(id);
  if (!s) return null;
  return (
    <button
      type="button"
      onClick={() => open({ kind: "sentence", ids: [id] })}
      className={withText ? "group text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" : `${chip} border-line bg-canvas`}
      aria-label={`${stampOf(s)} 발화 보기`}
    >
      {withText ? (
        <>
          <span className="mr-1.5 text-[13px] font-semibold text-secondary underline underline-offset-2 tabular group-hover:text-ink">{stampOf(s)}</span>
          <span className="text-[14px] leading-[22px]">{s.text}</span>
        </>
      ) : (
        stampOf(s)
      )}
    </button>
  );
}

/** Opens the transcript at the first of `ids` (e.g. the sentences of one Q&A answer). */
export function AnswerRef({ ids }: { ids: string[] }) {
  const { open, sentence } = useCite();
  const found = ids.map(sentence).filter((s): s is TranscriptSentence => !!s);
  if (!found.length) return null;
  return (
    <button type="button" onClick={() => open({ kind: "sentence", ids: found.map((s) => s.id) })} className={`${chip} border-line bg-canvas`} aria-label={`${stampOf(found[0])} 답변 원문 보기`}>
      원문 {mmss(Math.floor(found[0].t))}
    </button>
  );
}

function PageSheet({ session, doc, page, quote, onClose }: { session: SessionRecord; doc: DocRole; page: number; quote?: string | null; onClose: () => void }) {
  const stored = session.docs[doc];
  const [blob, setBlob] = useState<Blob | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!stored) return;
    getBlob(stored.pdfKey)
      .then((b) => alive && setBlob(b ?? null))
      .catch(() => alive && setBlob(null));
    return () => {
      alive = false;
    };
  }, [stored]);
  const pageText = stored?.pageTexts[page - 1]?.trim();
  return (
    <Dialog open onClose={onClose} title={`${DOC_LABEL[doc]} ${page}쪽`}>
      {stored && <p className="mt-0.5 truncate text-[13px] text-secondary">{stored.filename}</p>}
      {quote && (
        <p className="mt-2 rounded-[14px] bg-surface px-3 py-2 text-[14px] leading-[21px]">
          <span className="font-semibold">인용</span> {quote}
        </p>
      )}
      <div className="mt-3" style={{ ["--slide-max-h" as string]: "calc(var(--app-h) * 0.5)" }}>
        {!stored ? (
          <p className="text-[15px] text-secondary">이 기록에는 {DOC_LABEL[doc]}가 없어요.</p>
        ) : blob === undefined ? (
          <div className="aspect-[4/3] w-full animate-pulse rounded-[20px] bg-surface" aria-label="자료를 불러오는 중" />
        ) : blob && !error ? (
          <SlideViewer src={blob} initialPage={page} keyboard="focus" label={`${DOC_LABEL[doc]} 보기`} onError={(m) => setError(m)} />
        ) : (
          <div className="rounded-[20px] bg-surface p-4">
            <p className="text-[15px] font-semibold">{error ?? "원본 PDF를 이 기기에서 찾을 수 없어요."}</p>
            {pageText && <p className="mt-2 line-clamp-[8] whitespace-pre-line text-[14px] leading-[21px] text-secondary">{pageText}</p>}
          </div>
        )}
      </div>
      <div className="mt-4">
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
      </div>
    </Dialog>
  );
}

function TranscriptSheet({ transcript, ids, onClose }: { transcript: TranscriptSentence[]; ids: string[]; onClose: () => void }) {
  const target = transcript.find((s) => s.id === ids[0]);
  const list = transcript.filter((s) => s.phase === target?.phase).sort((a, b) => a.t - b.t);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[data-target]");
    el?.scrollIntoView({ block: "center" });
  }, [ids]);
  return (
    <Dialog open onClose={onClose} title={target ? `${PHASE_LABEL[target.phase]} 전사` : "전사"}>
      <ol ref={listRef} className="mt-3 flex max-h-[calc(var(--app-h)*0.55)] flex-col gap-1 overflow-y-auto overscroll-contain break-keep [overflow-wrap:anywhere]" aria-label="발화 기록">
        {list.map((s) => {
          const hit = ids.includes(s.id);
          return (
            <li
              key={s.id}
              data-target={s.id === ids[0] ? "" : undefined}
              aria-current={hit ? "true" : undefined}
              className={`grid grid-cols-[52px_minmax(0,1fr)] gap-2 rounded-[14px] px-3 py-2 ${hit ? "bg-ink text-inverse" : ""}`}
            >
              <span className={`text-[13px] font-semibold leading-[22px] tabular ${hit ? "" : "text-secondary"}`}>{mmss(Math.floor(s.t))}</span>
              <span className="text-[15px] leading-[22px]">
                {s.text}
                {s.slide ? <span className={`ml-1.5 text-[12px] ${hit ? "opacity-80" : "text-secondary"}`}>p.{s.slide}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-4">
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
      </div>
    </Dialog>
  );
}

// ── Inline citations inside LLM-written text ──
// "(발표자료 p.3·5–6)", "제안서 p.34", "p.8" (doc from the nearest label before it, else `doc`) and "[16]" / "[3]–[7]"
// (presentation sentence numbers) become links; everything else is plain text with soft breaks after "·".

const DOC_WORD: Record<string, DocRole> = { 발표자료: "presentation", 덱: "presentation", 제안자료: "proposal", 제안서: "proposal" };
const CITE_RE = /(?:(발표자료|제안자료|덱|제안서)\s*)?p\.\s?(\d+(?:\s*[–~-]\s*\d+)?(?:\s*[·,]\s*\d+(?:\s*[–~-]\s*\d+)?)*)|\[(\d+)\](?:\s*[–~-]\s*\[(\d+)\])?/g;
const soft = (s: string) => s.replace(/([·,/])(?=\S)/g, "$1\u200b");
const inline = "rounded-sm font-semibold underline decoration-1 underline-offset-2 tabular hover:text-ink focus-visible:outline-2 focus-visible:outline-ink";

export function CiteText({ text, doc: fallback = "presentation" }: { text: string; doc?: DocRole }) {
  const { open, numbered } = useCite();
  const out: React.ReactNode[] = [];
  let last = 0;
  let doc = fallback;
  let k = 0;
  for (const m of text.matchAll(CITE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(soft(text.slice(last, at)));
    last = at + m[0].length;
    if (m[2]) {
      if (m[1]) doc = DOC_WORD[m[1]];
      const d = doc;
      if (m[1]) out.push(`${m[1]} `);
      m[2].split(/\s*[·,]\s*/).forEach((tok, j) => {
        const page = Number(tok.match(/\d+/)?.[0]);
        const link = (
          <button type="button" className={inline} onClick={() => open({ kind: "page", doc: d, page })} aria-label={`${DOC_LABEL[d]} ${page}쪽 보기`}>
            {tok.replace(/\s+/g, "")}
          </button>
        );
        // "p." stays on the same line as the first page number.
        out.push(
          <span key={k++} className="whitespace-nowrap">
            {j ? "·" : "p."}
            {link}
          </span>,
        );
      });
    } else {
      const a = Number(m[3]);
      const b = m[4] ? Number(m[4]) : a;
      const ss: TranscriptSentence[] = [];
      for (let i = Math.min(a, b); i <= Math.max(a, b) && ss.length < 30; i++) {
        const s = numbered(i);
        if (s) ss.push(s);
      }
      if (!ss.length) {
        out.push(m[0]);
        continue;
      }
      const label = ss.length > 1 ? `${stampOf(ss[0])}–${mmss(Math.floor(ss[ss.length - 1].t))}` : stampOf(ss[0]);
      out.push(
        <button key={k++} type="button" className={inline} onClick={() => open({ kind: "sentence", ids: ss.map((s) => s.id) })} aria-label={`${label} 발화 보기`}>
          {label}
        </button>,
      );
    }
  }
  if (last < text.length) out.push(soft(text.slice(last)));
  return <>{out}</>;
}
