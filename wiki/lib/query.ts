import "server-only";
import path from "node:path";
import { friendlyLlmError } from "./errors";
import { LlmUnavailableError, llmJson, withRetry } from "./llm";
import { approxTokens, buildFrontmatter, extractCitations, normalizeSlug, parseFrontmatter } from "./markdown";
import { AnswerSchema, SelectSchema, answerPrompt, selectPrompt } from "./prompts";
import { rebuildIndex } from "./ingest";
import { appendLog, fileMtime, listPages, readAllRawPages, readKeyNumbers, readMeta, readPage, readStatusFile, wikiDir, writePage } from "./store";
import type { KeyNumber, QueryOptions, QueryResult, WikiPageInfo } from "./types";

// QUERY (Karpathy): read index.md → pick relevant pages → (one link hop) → compact cited context → optional answer.

const cache = new Map<string, QueryResult>();

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- lexical scoring (fallback selector + section ranking). Korean → char bigrams.
function grams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^\p{L}\p{N}%]+/u)) {
    if (!w) continue;
    if (/^[\p{N}%]+$/u.test(w)) {
      out.add(w);
      continue;
    }
    if (w.length < 2) continue;
    if (/^[a-z]+$/.test(w)) out.add(w);
    else for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
  }
  return out;
}
const STOP = new Set(["무엇", "어떻", "얼마", "있나", "는지", "인가", "대해", "알려", "주세", "세요", "어떤", "합니", "니까"]);
function lexScore(q: Set<string>, text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const g of q) if (!STOP.has(g) && t.includes(g)) s += g.length >= 3 || /\d/.test(g) ? 2 : 1;
  return s;
}

function lexicalSelect(pages: (WikiPageInfo & { body: string })[], query: string, n: number): string[] {
  const q = grams(query);
  return pages
    .map((p) => ({ slug: p.slug, s: lexScore(q, p.title) * 3 + lexScore(q, p.summary) * 2 + Math.min(lexScore(q, p.body), 20) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.slug);
}

/** Fit one page body into `cap` chars: the whole page, or its most query-relevant LINES (bullets / table rows)
 *  regrouped under their section headings in original order. Line-level packing matters because wiki pages are
 *  long fact lists: whole-section packing used to drop e.g. "1공장 생산능력 월 25만 세트" from a big 운영 section,
 *  and 주요-수치's table (which sits before any "##") was cut at 30% of the cap. Table header rows are kept with
 *  any kept row so tables stay readable. */
function fitPage(body: string, cap: number, q: Set<string>): { text: string; truncated: boolean } {
  const clean = body.replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= cap) return { text: clean, truncated: false };
  const MARK = "_(일부 섹션 생략)_";
  const lines = clean.split("\n");
  // intro = "# title" + leading blockquote/plain lines before the first section/list/table
  let k = 0;
  while (k < lines.length && !/^(##\s|\s*[-*]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[k])) k++;
  let intro = lines.slice(0, k).join("\n").trim();
  if (intro.length > cap * 0.25) intro = intro.slice(0, Math.floor(cap * 0.25)) + "…";
  // groups: a "## section" (title = heading) or a table block inside it (title = header + separator rows)
  interface Unit { g: number; i: number; t: string; s: number }
  const titles: string[] = [];
  const secOf: number[] = [];
  const units: Unit[] = [];
  let sec = -1;
  let g = -1;
  let i = 0;
  const newGroup = (title: string) => {
    titles.push(title);
    secOf.push(sec);
    return titles.length - 1;
  };
  g = newGroup("");
  for (let n = k; n < lines.length; n++) {
    const l = lines[n];
    if (/^##\s/.test(l)) {
      sec++;
      g = newGroup(l);
      continue;
    }
    if (/^\s*\|/.test(l) && n + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[n + 1]) && !/^\s*\|/.test(lines[n - 1] ?? "")) {
      const tg = newGroup(`${l}\n${lines[n + 1]}`);
      n += 2;
      while (n < lines.length && /^\s*\|/.test(lines[n])) units.push({ g: tg, i: i++, t: lines[n++], s: 0 });
      n--;
      continue;
    }
    if (l.trim()) units.push({ g, i: i++, t: l, s: 0 });
  }
  for (const u of units) u.s = lexScore(q, u.t) * 2 + lexScore(q, titles[u.g]);
  const ranked = [...units].sort((a, b) => b.s - a.s || a.i - b.i);
  let used = intro.length + MARK.length + 2;
  const kept = new Set<Unit>();
  const opened = new Set<number>();
  for (const u of ranked) {
    // a table group also needs its section heading
    const need = [u.g, ...(titles[u.g].startsWith("|") && secOf[u.g] >= 0 ? [titles.findIndex((t, j) => secOf[j] === secOf[u.g] && t.startsWith("##"))] : [])].filter(
      (x) => x >= 0 && !opened.has(x) && titles[x],
    );
    const cost = u.t.length + 1 + need.reduce((a, x) => a + titles[x].length + 1, 0);
    if (used + cost > cap) continue;
    kept.add(u);
    for (const x of need) opened.add(x);
    opened.add(u.g);
    used += cost;
  }
  const out: string[] = [intro];
  let lastG = -1;
  for (const u of units) {
    if (!kept.has(u)) continue;
    if (u.g !== lastG) {
      const t = titles[u.g];
      if (t.startsWith("|")) {
        const h = titles.findIndex((x, j) => secOf[j] === secOf[u.g] && x.startsWith("##"));
        if (h >= 0 && !out.includes(titles[h])) out.push(titles[h]);
      }
      if (t && !out.includes(t)) out.push(t);
      lastG = u.g;
    }
    out.push(u.t);
  }
  out.push(MARK);
  return { text: out.filter(Boolean).join("\n"), truncated: true };
}

/** (p.N) groups plus bare "p.64" mentions the model sometimes writes inline. */
function answerCitations(answer: string, pageCount: number): number[] {
  const set = new Set(extractCitations(answer));
  for (const m of answer.matchAll(/(?<![\w.])p{1,2}\.\s?(\d{1,4})(?:\s?[–\-~]\s?(\d{1,4}))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = a; p <= Math.min(b, a + 30); p++) set.add(p);
  }
  return [...set].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
}

export async function queryWiki(docId: string, query: string, opts: QueryOptions = {}): Promise<QueryResult> {
  const t0 = Date.now();
  const maxContextChars = Math.max(800, Math.min(opts.maxContextChars ?? 6000, 60000));
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 4, 10));
  const followLinks = opts.followLinks ?? true;
  query = query.trim().slice(0, 1000);
  if (!query) throw new Error("query is empty");

  const [st, meta] = await Promise.all([readStatusFile(docId), readMeta(docId)]);
  if (!st || !meta) throw new Error(`unknown docId ${docId}`);
  if (st.state !== "ready") throw new Error(`wiki not ready (${st.state})`);

  const idxMtime = await fileMtime(path.join(wikiDir(docId), "index.md"));
  const key = JSON.stringify([docId, query, maxContextChars, maxPages, followLinks, !!opts.answer, opts.selector ?? "llm", opts.includeRaw !== false, idxMtime]);
  const hit = cache.get(key);
  if (hit && !opts.save) return { ...hit, timings: { ...hit.timings, totalMs: Date.now() - t0 } };

  const infos = await listPages(docId);
  const pages = await Promise.all(infos.map(async (p) => ({ ...p, body: parseFrontmatter((await readPage(docId, p.slug)) ?? "").body })));
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const indexMd = parseFrontmatter((await readPage(docId, "index")) ?? "").body;

  // Small source (e.g. a 12-slide deck): the immutable raw text fits in half the budget → it IS the context
  // (lossless and cheaper than wiki summaries). Only a small key-numbers block (conflicts + rows relevant to the
  // query) is added; no LLM selection is needed. Wiki pages are not appended, so context ≈ full text, not 2×.
  const rawMode = opts.includeRaw !== false && meta.chars <= maxContextChars * 0.5;
  const q = grams(query);
  let selector: "llm" | "lexical" = opts.selector ?? "llm";
  let selectError: string | undefined;
  let selected: string[] = [];
  let selectMs = 0;
  let truncated = false;
  let mode: QueryResult["mode"] = "wiki";
  const blocks: string[] = [];
  const included: string[] = [];

  if (rawMode) {
    mode = "raw+wiki";
    selector = "lexical";
    const rawPages = await readAllRawPages(docId, meta.pageCount);
    const rawBlock = `### 원문 전체 (raw, ${meta.pageCount}쪽)\n${rawPages.map((t, i) => `(p.${i + 1}) ${t.replace(/\s+/g, " ").trim()}`).join("\n")}`;
    blocks.push(rawBlock);
    const room = Math.min(maxContextChars - rawBlock.length - 2, Math.max(400, Math.floor(rawBlock.length * 0.15)));
    const nb = keyNumbersBlock(await readKeyNumbers(docId), q, room);
    if (nb) {
      blocks.push(nb);
      included.push("주요-수치");
      selected = ["주요-수치"];
    }
  } else {
    // 1) select — LLM over index.md with a hard deadline; lexical fallback is instant
    const ts = Date.now();
    if (selector === "llm") {
      try {
        const { system, user } = selectPrompt(indexMd, query, maxPages);
        const r = await llmJson({ tier: "select", name: "select_pages", system, user, schema: SelectSchema, signal: AbortSignal.timeout(opts.selectTimeoutMs ?? 5000) });
        selected = r.slugs.map((s) => normalizeSlug(s.split("|")[0].replace(/^\[\[|\]\]$/g, ""))).filter((s) => bySlug.has(s));
      } catch (e) {
        selector = "lexical";
        selectError = isTimeout(e)
          ? "LLM 페이지 선택이 제한 시간(5초)을 넘겨 어휘 매칭으로 골랐습니다."
          : `LLM 페이지 선택을 못 해 어휘 매칭으로 골랐습니다 (${e instanceof LlmUnavailableError ? e.detail : friendlyLlmError(e)}).`;
      }
      if (!selected.length) selector = "lexical";
    }
    if (selector === "lexical") selected = lexicalSelect(pages, query, maxPages);
    if (!selected.length) selected = ["overview"].filter((s) => bySlug.has(s));
    selected = [...new Set(selected)].slice(0, maxPages);
    selectMs = Date.now() - ts;

    // 2) one link hop: neighbours of the top-2 picks, ranked lexically, added only if budget remains
    const order = [...selected];
    if (followLinks) {
      const neigh = new Set<string>();
      for (const s of selected.slice(0, 2)) for (const l of bySlug.get(s)?.links ?? []) if (bySlug.has(l) && !order.includes(l)) neigh.add(l);
      const ranked = [...neigh]
        .map((s) => ({ s, sc: lexScore(q, bySlug.get(s)!.title + " " + bySlug.get(s)!.summary + " " + bySlug.get(s)!.body.slice(0, 3000)) }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc)
        .slice(0, 2);
      order.push(...ranked.map((x) => x.s));
    }

    // 3) budget allocation (water-filling over selected pages; hop pages only get leftovers)
    const header = (s: string) => `### [[${s}]] ${bySlug.get(s)?.title ?? s}\n`;
    const primary = order.slice(0, selected.length);
    const caps = new Map<string, number>();
    let remaining = maxContextChars - primary.reduce((a, s) => a + header(s).length + 2, 0);
    const pending = [...primary].sort((a, b) => bySlug.get(a)!.body.length - bySlug.get(b)!.body.length);
    while (pending.length) {
      const share = Math.floor(remaining / pending.length);
      const s = pending.shift()!;
      const need = bySlug.get(s)!.body.length + 40;
      const cap = Math.max(200, Math.min(need, share));
      caps.set(s, cap);
      remaining -= cap;
    }
    for (const s of primary) {
      if ((caps.get(s) ?? 0) < 300) continue;
      const f = fitPage(bySlug.get(s)!.body, caps.get(s)! - 40, q);
      truncated ||= f.truncated;
      blocks.push(header(s) + f.text);
      included.push(s);
    }
    let used = blocks.join("\n\n").length;
    for (const s of order.slice(selected.length)) {
      const room = maxContextChars - used - header(s).length - 2;
      if (room < 400) break;
      const f = fitPage(bySlug.get(s)!.body, room, q);
      blocks.push(header(s) + f.text);
      included.push(s);
      used = blocks.join("\n\n").length;
    }
  }
  const context = blocks.join("\n\n");

  // 4) answer
  // A failed answer never throws away the context: callers (judges/report) can still use `context`.
  let answer: string | undefined;
  let answerError: string | undefined;
  let answerMs: number | undefined;
  if (opts.answer || opts.save) {
    const ta = Date.now();
    const deadline = AbortSignal.timeout(opts.answerTimeoutMs ?? 60_000);
    try {
      const { system, user } = answerPrompt(context, query);
      answer = (await withRetry(() => llmJson({ tier: "answer", name: "answer", system, user, schema: AnswerSchema, signal: deadline }), 2)).answer.trim();
    } catch (e) {
      answerError = isTimeout(e) ? "답변 생성이 제한 시간을 넘겼습니다. 아래 컨텍스트는 그대로 쓸 수 있습니다." : friendlyLlmError(e);
    }
    answerMs = Date.now() - ta;
  }
  const contextCites = new Set(extractCitations(context));
  const citations = answer ? answerCitations(answer, meta.pageCount) : [...contextCites].sort((a, b) => a - b);

  const res: QueryResult = {
    docId,
    query,
    context,
    pages: included,
    selected,
    answer,
    answerError,
    selectError,
    citations,
    contextChars: context.length,
    fullTextChars: meta.chars,
    approxTokens: { context: approxTokens(context.length), fullText: approxTokens(meta.chars) },
    truncated,
    selector,
    mode,
    timings: { selectMs, answerMs, totalMs: Date.now() - t0 },
  };

  // 5) file good answers back into the wiki (Karpathy: explorations compound)
  if (opts.save && answer) res.savedAs = (await saveAnswer(docId, { query, answer, pages: included })).savedAs;

  await appendLog(
    docId,
    `## [${stamp()}] query | "${query.replace(/\n/g, " ").slice(0, 80)}" | ${selector}: ${included.join(", ")} | ${context.length}자${answer ? ` | 답변 인용 p.${citations.join(",") || "-"}` : ""}${answerError ? " | 답변 실패" : ""}${selectError ? " | 선택기 폴백" : ""}${res.savedAs ? ` | 저장 [[${res.savedAs}]]` : ""}\n`,
  ).catch(() => {});

  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  // degraded results (fallback selector / failed answer) are not cached, so they recover once the provider does
  if (!opts.save && !answerError && !selectError) cache.set(key, res);
  return res;
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || /timed? ?out|aborted/i.test(e.message));

/** Small key-numbers block for raw mode: in-doc conflicts first, then rows that match the query. */
function keyNumbersBlock(rows: KeyNumber[], q: Set<string>, room: number): string {
  if (!rows.length || room < 200) return "";
  const head = "### [[주요-수치]] 주요 수치 (충돌·질문 관련 항목)\n";
  const scored = rows
    .map((r, i) => ({ r, i, s: (r.conflict ? 100 : 0) + lexScore(q, `${r.metric} ${r.value} ${r.note}`) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const lines: string[] = [];
  let used = head.length;
  for (const { r } of scored) {
    const l = `- ${r.conflict ? "⚠ " : ""}${r.metric} = ${r.value}${r.pages.length ? ` (p.${r.pages.join(", p.")})` : ""}${r.conflict && r.note ? ` — ${r.note}` : ""}`.slice(0, 220);
    if (used + l.length + 1 > room) continue;
    lines.push(l);
    used += l.length + 1;
  }
  return lines.length ? head + lines.join("\n") : "";
}

/** File an answer the user already reviewed into the wiki as an analysis page (no new LLM call). */
export async function saveAnswer(docId: string, a: { query: string; answer: string; pages?: string[] }): Promise<{ savedAs: string }> {
  const meta = await readMeta(docId);
  if (!meta) throw new Error(`unknown docId ${docId}`);
  const query = a.query.trim().slice(0, 1000);
  const answer = a.answer.trim().slice(0, 20000);
  if (!query || !answer) throw new Error("query/answer is empty");
  const known = new Set((await listPages(docId)).map((p) => p.slug));
  const pages = (a.pages ?? []).map(normalizeSlug).filter((s) => known.has(s));
  const slug = normalizeSlug(`질의-${query.replace(/[?？!.,]/g, "").split(/\s+/).slice(0, 5).join("-")}`);
  const body = `# 질의: ${query}\n\n> ${answer.split("\n")[0].slice(0, 120)}\n\n## 답변\n${answer}\n${pages.length ? `\n## 근거 페이지\n${pages.map((s) => `- [[${s}]]`).join("\n")}\n` : ""}`;
  const cites = extractCitations(answer).filter((p) => p <= meta.pageCount);
  await writePage(
    docId,
    slug,
    buildFrontmatter({ title: `질의: ${query.slice(0, 40)}`, type: "analysis", summary: answer.replace(/\s+/g, " ").replace(/\s*\(p{1,2}\.[^)]*\)/g, "").trim().slice(0, 60), sources: cites, updated: new Date().toISOString() }) + body,
  );
  await rebuildIndex(docId, meta.filename, meta.pageCount);
  await appendLog(docId, `## [${stamp()}] file | 질의 답변을 [[${slug}]]로 저장 | 인용 p.${cites.join(",") || "-"}\n`).catch(() => {});
  return { savedAs: slug };
}
