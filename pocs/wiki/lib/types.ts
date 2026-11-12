// Public types of the wiki PoC (safe to import from client components).

export type DocKind = "presentation" | "proposal";
export type WikiState = "queued" | "extracting" | "planning" | "merging" | "finalizing" | "ready" | "error";
export type PageType = "overview" | "entity" | "concept" | "topic" | "numbers" | "analysis" | "meta";

export interface DocMeta {
  docId: string;
  filename: string;
  kind: DocKind;
  sha256: string;
  pageCount: number;
  chars: number; // full extracted text length
  emptyPages: number[]; // pages with (almost) no extractable text (scans → no OCR in PoC)
  bytes: number;
  createdAt: string;
}

export interface UsageStat {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  ms: number; // summed latency
}

export interface IngestEvent {
  ts: string;
  phase: WikiState;
  msg: string;
  chunk?: number;
  chunksTotal?: number;
  created?: string[];
  updated?: string[];
}

export interface WikiStatus {
  docId: string;
  state: WikiState;
  filename: string;
  kind: DocKind;
  pageCount: number;
  chunksTotal: number;
  chunksDone: number; // extraction progress
  roundsTotal: number;
  roundsDone: number; // merge progress
  pagesCreated: number;
  pagesUpdated: number;
  wikiPages: number;
  provider?: string;
  usage: Record<string, UsageStat>; // by model id
  timings: Partial<Record<"extract" | "extracting" | "planning" | "merging" | "finalizing" | "total", number>>; // ms
  events: IngestEvent[];
  error?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** Set while "위키 다시 만들기" runs on a ready wiki: progress of the new build (built in staging dirs).
   *  The live wiki keeps state "ready" and stays readable/queryable until the new one is swapped in. */
  rebuild?: WikiStatus;
  /** Set (in Korean) when the last reingest of this ready wiki failed; the previous wiki was kept as is. */
  lastReingestError?: string;
  lastReingestAt?: string;
}

export interface WikiDocSummary {
  docId: string;
  filename: string;
  kind: DocKind;
  pageCount: number;
  chars: number;
  state: WikiState;
  wikiPages: number;
  createdAt: string;
  /** Set when state is "error" (e.g. "Invalid PDF structure"), also for docs that failed before meta.json existed. */
  error?: string;
  /** A reingest is building a new wiki in the background (the current one stays ready). */
  rebuilding?: boolean;
  /** Last reingest failed; the previous wiki was kept. */
  lastReingestError?: string;
}

export interface WikiPageInfo {
  slug: string;
  title: string;
  type: PageType;
  summary: string;
  sources: number[]; // cited raw pages
  links: string[]; // outgoing [[links]]
  chars: number;
  updated?: string;
}

export interface QueryOptions {
  maxContextChars?: number; // default 6000
  maxPages?: number; // default 4 (selected by LLM; link-hop pages may be added within budget)
  answer?: boolean; // also generate an answer with citations
  followLinks?: boolean; // default true
  save?: boolean; // file the answer back into the wiki as an analysis page (requires answer)
  selector?: "llm" | "lexical"; // default llm (falls back to lexical on failure or after selectTimeoutMs). lexical = no LLM call, ~0 ms
  selectTimeoutMs?: number; // default 5000: LLM selector deadline before lexical fallback
  answerTimeoutMs?: number; // default 60000
  includeRaw?: boolean; // default true: if the whole raw text fits in half the budget (small decks), include it verbatim
}

export interface QueryResult {
  docId: string;
  query: string;
  context: string; // compact cited markdown within budget
  pages: string[]; // slugs included in context (in order)
  selected: string[]; // slugs the selector picked
  answer?: string;
  /** Set (in Korean) when answer generation was requested but failed — the context is still returned. */
  answerError?: string;
  /** Set (in Korean) when the LLM selector failed or timed out and lexical selection was used instead. */
  selectError?: string;
  citations: number[]; // raw page numbers cited in answer (or in context if no answer)
  contextChars: number;
  fullTextChars: number;
  approxTokens: { context: number; fullText: number };
  truncated: boolean;
  selector: "llm" | "lexical";
  mode: "wiki" | "raw+wiki"; // raw+wiki = small doc: whole source text + a small key-numbers block (no wiki pages)
  savedAs?: string;
  /** Set (in Korean) when `save` was requested but filing the answer failed (e.g. a rebuild is running). */
  saveError?: string;
  timings: { selectMs: number; answerMs?: number; totalMs: number };
}

export interface KeyNumber {
  metric: string; // normalized name e.g. "세트당 원가"
  value: string; // as written e.g. "142원"
  pages: number[];
  note: string;
  conflict: boolean; // the same metric has different values within this doc
  /** LLM-cited pages whose raw text does not state this value (dropped from `pages` by the deterministic check). */
  unverified?: number[];
}

export type LintIssueType =
  | "contradiction"
  | "cross-doc-mismatch"
  | "orphan"
  | "broken-link"
  | "missing-citation"
  | "bad-citation"
  | "gap"
  | "missing-page"
  | "stale";

export interface LintIssue {
  type: LintIssueType;
  severity: "high" | "medium" | "low";
  message: string;
  pages: string[]; // slugs involved
  citations: number[]; // raw pages (this doc)
  otherCitations?: number[]; // raw pages in the `against` doc
}

export interface LintReport {
  docId: string;
  against?: string;
  issues: LintIssue[];
  /** Set (in Korean) when the LLM checks could not run; `issues` then holds only the deterministic checks. */
  llmError?: string;
  checkedAt: string;
  ms: number;
}
