import "server-only";
import { friendlyLlmError } from "./errors";
import { llmJson, withRetry } from "./llm";
import { CITATION_RE, parseFrontmatter } from "./markdown";
import { LintSchema, lintPrompt } from "./prompts";
import { listPages, readPage, type WikiDoc } from "./store";
import type { KeyNumber, LintIssue, LintReport } from "./types";

// LINT (Karpathy): health-check the wiki. Deterministic checks (links, orphans, citations) + LLM checks
// (contradictions, gaps, missing pages). With `against`, also cross-document number mismatches.

const numbersText = (rows: KeyNumber[]) => rows.map((r) => `- ${r.metric} = ${r.value} (p.${r.pages.join(",")})${r.conflict ? " ⚠충돌" : ""}${r.note ? ` — ${r.note}` : ""}`).join("\n");

/** Distinctive figures in a message, e.g. "118원", "340억", "3.1%", "25만". */
function figures(msg: string): string[] {
  const out = new Set<string>();
  for (const m of msg.matchAll(/\d[\d,.]*\s?(?:원|억|조|만|%|곳|배)/g)) {
    const t = m[0].replace(/[\s,]/g, "");
    if (t.replace(/\D/g, "").length >= 2) out.add(t);
  }
  return [...out];
}
/** Pages (1-based) ranked by how many of the figures they contain; max 5. */
function groundPages(raw: string[], tokens: string[]): number[] {
  if (!tokens.length) return [];
  return raw
    .map((t, i) => {
      const n = t.replace(/[\s,]/g, "");
      return { p: i + 1, c: tokens.filter((k) => n.includes(k)).length };
    })
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c || a.p - b.p)
    .slice(0, 5)
    .map((x) => x.p)
    .sort((a, b) => a - b);
}
/** Concatenated page bodies (overview first) within a char budget, for LLM checks that need content. */
function wikiDigest(doc: WikiDoc, slugs: string[], budget: number): string {
  const order = ["overview", ...slugs.filter((s) => s !== "overview" && s !== "주요-수치")];
  const parts: string[] = [];
  let used = 0;
  for (const s of order) {
    const body = parseFrontmatter((readPage(doc, s)) ?? "").body.trim();
    const room = budget - used;
    if (room < 500) break;
    const t = `### [[${s}]]\n${body.length > room ? body.slice(0, room) + "…" : body}`;
    parts.push(t);
    used += t.length;
  }
  return parts.join("\n\n");
}

export async function lintWiki(doc: WikiDoc, opts: { against?: WikiDoc; signal?: AbortSignal } = {}): Promise<LintReport> {
  const t0 = Date.now();
  const { docId } = doc;
  const pageCount = doc.raw.length;
  const pages = listPages(doc);
  const slugs = new Set([...pages.map((p) => p.slug), "index"]);
  const issues: LintIssue[] = [];

  // ---- deterministic
  const inbound = new Map<string, number>();
  for (const p of pages) for (const l of p.links) inbound.set(l, (inbound.get(l) ?? 0) + 1);
  for (const p of pages) {
    const broken = p.links.filter((l) => !slugs.has(l));
    if (broken.length) issues.push({ type: "broken-link", severity: "low", message: `[[${p.slug}]]에 없는 페이지 링크: ${broken.map((b) => `[[${b}]]`).join(", ")}`, pages: [p.slug], citations: [] });
    if (p.slug !== "overview" && p.type !== "analysis" && !inbound.get(p.slug))
      issues.push({ type: "orphan", severity: "low", message: `[[${p.slug}]]를 링크하는 페이지가 없습니다(index에만 있음)`, pages: [p.slug], citations: [] });
    const bad = p.sources.filter((n) => n > pageCount);
    if (bad.length) issues.push({ type: "bad-citation", severity: "medium", message: `[[${p.slug}]]가 존재하지 않는 쪽을 인용: p.${bad.join(", p.")} (전체 ${pageCount}쪽)`, pages: [p.slug], citations: bad });
    // bullet lines with digits but no citation
    const body = parseFrontmatter((readPage(doc, p.slug)) ?? "").body;
    const uncited = body
      .split("\n")
      .filter((l) => /^\s*[-*]\s/.test(l) && /\d/.test(l) && !l.match(CITATION_RE) && !/\[\[/.test(l) && !/(?<![\w.])p\.\s?\d/.test(l))
      .slice(0, 3);
    if (uncited.length)
      issues.push({ type: "missing-citation", severity: "low", message: `[[${p.slug}]]에 출처 없는 수치 문장 ${uncited.length}개: "${uncited[0].trim().slice(0, 60)}"`, pages: [p.slug], citations: [] });
  }

  // ---- LLM
  const nums = doc.keyNumbers;
  const conflicts = nums.filter((n) => n.conflict);
  const indexMd = parseFrontmatter((readPage(doc, "index")) ?? "").body;
  let other: Parameters<typeof lintPrompt>[0]["other"];
  if (opts.against) {
    const against = opts.against;
    other = { kind: against.kind, filename: against.filename, numbers: numbersText(against.keyNumbers), indexMd: parseFrontmatter(readPage(against, "index") ?? "").body };
  }
  const pagesText = wikiDigest(doc, pages.map((p) => p.slug), opts.against ? 30000 : 45000);
  const { system, user } = lintPrompt({ kind: doc.kind, filename: doc.filename, indexMd, pagesText, numbers: numbersText(nums), conflicts: numbersText(conflicts), other });
  // LLM checks are best-effort: when the provider is down the deterministic issues are still reported.
  let llmError: string | undefined;
  const timeout = AbortSignal.timeout(120_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const llm = await withRetry(() => llmJson({ tier: "lint", name: "lint", system, user, schema: LintSchema, signal }), 2).catch((e) => {
    llmError = `LLM 점검(모순·자료 공백·문서 간 불일치)을 건너뛰었습니다: ${friendlyLlmError(e)}`;
    return { issues: [] as { type: LintIssue["type"]; severity: LintIssue["severity"]; message: string; pages: string[]; citations: number[]; otherCitations?: number[] }[] };
  });
  const rawThis = doc.raw;
  const rawOther = opts.against?.raw ?? [];
  for (const i of llm.issues) {
    // Ground citations in the immutable raw text: pages that actually contain the figures named in the message.
    const tokens = figures(i.message);
    const g1 = groundPages(rawThis, tokens);
    const g2 = groundPages(rawOther, tokens);
    const llmCites = i.citations.filter((n) => n >= 1 && n <= pageCount);
    issues.push({
      ...i,
      pages: i.pages.filter((s) => slugs.has(s)),
      citations: g1.length ? g1 : llmCites,
      otherCitations: opts.against && i.type === "cross-doc-mismatch" ? (g2.length ? g2 : i.otherCitations) : undefined,
    });
  }

  const sev = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => sev[a.severity] - sev[b.severity]);
  const report: LintReport = { docId, against: opts.against?.docId, issues, llmError, checkedAt: new Date().toISOString(), ms: Date.now() - t0 };
  return report;
}
