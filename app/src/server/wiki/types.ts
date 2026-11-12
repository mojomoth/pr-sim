// Public types of the wiki module (client-safe: no server imports).

export type DocKind = "presentation" | "proposal";
export type PageType = "overview" | "entity" | "concept" | "topic" | "numbers" | "analysis" | "meta";

/** One wiki page as sent to / from the client. `markdown` is the page body without frontmatter; citations are (p.N). */
export interface WikiPage {
  slug: string;
  title: string;
  type: PageType;
  summary: string;
  sources: number[];
  markdown: string;
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

export interface KeyNumber {
  metric: string; // normalized name e.g. "세트당 원가"
  value: string; // as written e.g. "142원"
  pages: number[];
  note: string;
  conflict: boolean; // the same metric has different values within this doc
  /** LLM-cited pages whose raw text does not state this value (dropped from `pages` by the deterministic check). */
  unverified?: number[];
}

export interface UsageStat {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  ms: number; // summed latency
}

/** POST /api/wiki NDJSON events. */
export type WikiEvent =
  | { type: "progress"; phase: "extracting" | "planning" | "merging" | "finalizing"; chunksDone: number; chunksTotal: number; roundsDone: number; roundsTotal: number; msg: string }
  | { type: "done"; wiki: WikiPage[]; keyNumbers: KeyNumber[]; usage: Record<string, UsageStat>; ms: number; degraded: boolean };

export interface QueryOptions {
  maxContextChars?: number; // default 6000
  maxPages?: number; // default 4
  answer?: boolean; // also generate an answer with citations
  followLinks?: boolean; // default true
  selector?: "llm" | "lexical"; // default llm (falls back to lexical on failure or after selectTimeoutMs)
  selectTimeoutMs?: number; // default 5000
  answerTimeoutMs?: number; // default 60000
  includeRaw?: boolean; // default true: if the whole raw text fits in half the budget, include it verbatim
}

export interface QueryResult {
  docId: string;
  query: string;
  context: string;
  pages: string[];
  selected: string[];
  answer?: string;
  answerError?: string;
  selectError?: string;
  citations: number[];
  contextChars: number;
  fullTextChars: number;
  approxTokens: { context: number; fullText: number };
  truncated: boolean;
  selector: "llm" | "lexical";
  mode: "wiki" | "raw+wiki";
  timings: { selectMs: number; answerMs?: number; totalMs: number };
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
  llmError?: string;
  checkedAt: string;
  ms: number;
}
