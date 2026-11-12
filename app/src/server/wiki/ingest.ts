import "server-only";
import { llmJson, pool, withRetry, type CallUsage } from "./llm";
import { buildFrontmatter, compactPages, extractCitations, normalizeSlug, parseFrontmatter } from "./markdown";
import { verifyKeyNumbers } from "./numbers-verify";
import { checkableFigures, normRaw, pageSummary, regroundCitations } from "./reground";
import {
  ExtractSchema, NumbersSchema, OverviewSchema, PlanSchema, WriteSchema,
  extractPrompt, numbersPrompt, overviewPrompt, planPrompt, writePrompt,
  type ExtractNotes, type Plan, type WriteOp,
} from "./prompts";
import { RESERVED, docChars, listPages, readPage, rebuildIndex, writePage, type WikiDoc } from "./store";
import type { KeyNumber, PageType, UsageStat, WikiEvent } from "./types";

interface Chunk {
  i: number;
  pages: { n: number; text: string }[];
}

function makeChunks(texts: string[]): Chunk[] {
  const maxPages = texts.length <= 16 ? 6 : 8;
  const maxChars = 14000;
  const chunks: Chunk[] = [];
  let cur: Chunk["pages"] = [];
  let chars = 0;
  texts.forEach((text, idx) => {
    if (cur.length && (cur.length >= maxPages || chars + text.length > maxChars)) {
      chunks.push({ i: chunks.length, pages: cur });
      cur = [];
      chars = 0;
    }
    cur.push({ n: idx + 1, text });
    chars += text.length;
  });
  if (cur.length) chunks.push({ i: chunks.length, pages: cur });
  return chunks;
}

type Fact = { claim: string; pages: number[] };

/** The ingest pipeline (EXTRACT → PLAN → MERGE → FINALIZE) over cleaned, immutable raw pages. */
export async function buildWiki(
  doc: WikiDoc,
  opts: { onProgress?: (e: Extract<WikiEvent, { type: "progress" }>) => void; signal?: AbortSignal } = {},
): Promise<{ usage: Record<string, UsageStat>; ms: number }> {
  const t0 = Date.now();
  opts.signal?.throwIfAborted();
  if (docChars(doc) < 50) throw new Error("추출 가능한 텍스트가 없습니다");
  const { raw: texts, kind, filename } = doc;
  const totalPages = texts.length;
  const usage: Record<string, UsageStat> = {};
  const onUsage = (u: CallUsage) => {
    const k = `${u.provider}:${u.model}`;
    const cur = (usage[k] ??= { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 });
    cur.calls++;
    cur.inputTokens += u.inputTokens;
    cur.outputTokens += u.outputTokens;
    cur.ms += u.ms;
  };
  const progress: Extract<WikiEvent, { type: "progress" }> = {
    type: "progress", phase: "extracting",
    chunksDone: 0, chunksTotal: 0, roundsDone: 0, roundsTotal: 0, msg: "",
  };
  const emit = (msg: string) => {
    progress.msg = msg;
    try {
      opts.onProgress?.({ ...progress });
    } catch {
      /* listener errors are not ours */
    }
  };
  emit("PDF 텍스트 추출 중");

  // ---- 1) EXTRACT: per-chunk notes, parallel
  const chunks = makeChunks(texts);
  progress.chunksTotal = chunks.length;
  emit(`${totalPages}쪽 → ${chunks.length}개 청크로 나눠 병렬 추출 시작`);
  const notes = await pool(chunks, 8, async (c) => {
    opts.signal?.throwIfAborted();
    const range = `p.${c.pages[0].n}–${c.pages[c.pages.length - 1].n}`;
    const lo = c.pages[0].n;
    const hi = c.pages[c.pages.length - 1].n;
    let n: ExtractNotes;
    if (c.pages.every((p) => p.text.length < 20)) n = { summary: "", topics: [], numbers: [] };
    else {
      const { system, user } = extractPrompt(kind, filename, c.pages, totalPages);
      n = await withRetry(() => llmJson({ tier: "extract", name: "chunk_notes", system, user, schema: ExtractSchema, onUsage, signal: opts.signal }));
    }
    // keep only citations inside this chunk; an out-of-chunk citation is replaced by the chunk page(s) that
    // actually state the claim's figures (previously it was clamped to the chunk's first page → wrong cites)
    const inRange = (ps: number[]) => [...new Set(ps.map(Math.round).filter((p) => p >= lo && p <= hi))];
    const chunkNorm = c.pages.map((p) => ({ n: p.n, t: normRaw(p.text) }));
    const fallback = (claim: string) => {
      const figs = checkableFigures(claim);
      const hits = figs.length ? chunkNorm.filter((p) => figs.some((f) => p.t.includes(f))).map((p) => p.n) : [];
      return hits.length ? hits.slice(0, 3) : [lo];
    };
    for (const t of n.topics) {
      t.slug = normalizeSlug(t.slug);
      if (RESERVED.has(t.slug)) t.slug = `${t.slug}-내용`;
      for (const f of t.facts) f.pages = inRange(f.pages).length ? inRange(f.pages) : fallback(f.claim);
    }
    n.topics = n.topics.filter((t) => t.slug && t.facts.length);
    for (const x of n.numbers) x.pages = inRange(x.pages).length ? inRange(x.pages) : fallback(`${x.value} ${x.context}`);
    progress.chunksDone++;
    emit(
      `청크 ${progress.chunksDone}/${chunks.length} 추출 완료 (${range}) · 주제 ${n.topics.length} · 사실 ${n.topics.reduce((a, t) => a + t.facts.length, 0)} · 수치 ${n.numbers.length}`,
    );
    return n;
  });

  // ---- 2) PLAN: consolidate candidate slugs into the final page structure
  opts.signal?.throwIfAborted();
  progress.phase = "planning";
  emit("주제 후보를 정리해 위키 페이지 구조를 계획하는 중");
  const cand = new Map<string, { slug: string; title: string; type: string; facts: number; sample: string }>();
  for (const n of notes)
    for (const t of n.topics) {
      const c = cand.get(t.slug) ?? { slug: t.slug, title: t.title, type: t.type, facts: 0, sample: t.facts[0]?.claim.slice(0, 80) ?? "" };
      c.facts += t.facts.length;
      cand.set(t.slug, c);
    }
  const maxPages = Math.round(Math.min(30, 10 + totalPages / 6));
  let plan: Plan;
  try {
    const { system, user } = planPrompt(kind, [...cand.values()], maxPages);
    plan = await withRetry(() => llmJson({ tier: "plan", name: "wiki_plan", system, user, schema: PlanSchema, onUsage, signal: opts.signal }), 2);
  } catch {
    opts.signal?.throwIfAborted();
    plan = { pages: [...cand.values()].map((c) => ({ slug: c.slug, title: c.title, type: c.type as "topic", from: [c.slug] })) };
  }
  const alias = new Map<string, string>();
  const pageMeta = new Map<string, { title: string; type: PageType }>();
  for (const p of plan.pages) {
    let slug = normalizeSlug(p.slug);
    if (!slug) continue;
    if (RESERVED.has(slug)) slug = `${slug}-내용`;
    if (!pageMeta.has(slug)) pageMeta.set(slug, { title: p.title, type: p.type });
    for (const f of [...p.from, p.slug]) alias.set(normalizeSlug(f), slug);
  }
  for (const c of cand.values())
    if (!alias.has(c.slug)) {
      alias.set(c.slug, c.slug);
      if (!pageMeta.has(c.slug)) pageMeta.set(c.slug, { title: c.title, type: c.type as PageType });
    }
  emit(`후보 ${cand.size}개 → 위키 페이지 ${pageMeta.size}개로 계획`);

  // ---- 3) MERGE: incremental rounds in page order; within a round, one writer per touched page (parallel)
  opts.signal?.throwIfAborted();
  progress.phase = "merging";
  emit("라운드별로 위키 페이지를 생성·갱신하는 중");
  const rounds = Math.max(1, Math.min(5, Math.ceil(chunks.length / 3)));
  const per = Math.ceil(chunks.length / rounds);
  progress.roundsTotal = Math.ceil(chunks.length / per);
  const allPages = () => [...pageMeta].map(([slug, m]) => ({ slug, title: m.title })).concat([{ slug: "주요-수치", title: "주요 수치" }, { slug: "overview", title: "개요" }]);

  for (let r = 0; r < progress.roundsTotal; r++) {
    opts.signal?.throwIfAborted();
    const rc = chunks.slice(r * per, (r + 1) * per);
    const rangeLabel = `p.${rc[0].pages[0].n}–${rc[rc.length - 1].pages[rc[rc.length - 1].pages.length - 1].n}`;
    const factsBySlug = new Map<string, Fact[]>();
    for (const c of rc)
      for (const t of notes[c.i].topics) {
        const slug = alias.get(t.slug) ?? t.slug;
        const arr = factsBySlug.get(slug) ?? [];
        arr.push(...t.facts);
        factsBySlug.set(slug, arr);
      }
    const indexMd = readPage(doc, "index") ?? "";
    const results = await pool([...factsBySlug], 10, async ([slug, facts]) => {
      opts.signal?.throwIfAborted();
      const m = pageMeta.get(slug) ?? { title: slug, type: "topic" as PageType };
      const existingMd = readPage(doc, slug);
      const parsed = existingMd ? parseFrontmatter(existingMd) : null;
      const existing = parsed ? parsed.body : null;
      let op: WriteOp;
      try {
        const { system, user } = writePrompt({ kind, filename, slug, title: m.title, existing, facts, indexMd, allPages: allPages(), round: r + 1, rounds: progress.roundsTotal, pageRange: rangeLabel });
        op = await withRetry(() => llmJson({ tier: "write", name: "page_op", system, user, schema: WriteSchema, onUsage, signal: opts.signal }), 2);
      } catch {
        opts.signal?.throwIfAborted();
        op = { action: existing ? "append" : "create", title: m.title, summary: "", markdown: factsSection(m.title, facts, !existing) };
      }
      const applied = applyOp(doc, slug, m, existing, op, facts, totalPages, parsed?.fm.summary);
      return { slug, applied };
    });
    const c2: string[] = [];
    const u2: string[] = [];
    for (const { slug, applied } of results) {
      if (applied === "create") {
        c2.push(slug);
      } else if (applied !== "skip") u2.push(slug);
    }
    rebuildIndex(doc);
    progress.roundsDone = r + 1;
    emit(`라운드 ${r + 1}/${progress.roundsTotal} (${rangeLabel}) · 생성 ${c2.length} · 갱신 ${u2.length}`);
  }

  // ---- 4) FINALIZE: overview (strong model) ∥ key numbers (fast model)
  opts.signal?.throwIfAborted();
  progress.phase = "finalizing";
  emit("개요(overview)와 주요-수치 페이지 작성 중");
  const indexMd = readPage(doc, "index") ?? "";
  const rawNumbers = notes.flatMap((n) => n.numbers);
  const [ov, nums] = await Promise.all([
    withRetry(() => {
      const { system, user } = overviewPrompt(kind, filename, totalPages, indexMd, notes.map((n) => n.summary).filter(Boolean));
      return llmJson({ tier: "overview", name: "overview", system, user, schema: OverviewSchema, onUsage, signal: opts.signal });
    }, 2).catch(() => {
      opts.signal?.throwIfAborted();
      return null;
    }),
    withRetry(() => {
      const { system, user } = numbersPrompt(kind, filename, rawNumbers);
      return llmJson({ tier: "numbers", name: "key_numbers", system, user, schema: NumbersSchema, onUsage, signal: opts.signal });
    }, 2).catch(() => {
      opts.signal?.throwIfAborted();
      return null;
    }),
  ]);
  opts.signal?.throwIfAborted();
  const llmNumbers: KeyNumber[] = (nums?.numbers ?? rawNumbers.map((x) => ({ metric: x.metric, value: x.value, pages: x.pages, note: x.context, conflict: false }))).map((k) => ({
    ...k,
    pages: [...new Set(k.pages.map(Math.round).filter((p) => p >= 1 && p <= totalPages))].sort((a, b) => a - b),
  }));
  // deterministic check against the raw pages: drop citations that don't state the value, flag missed conflicts
  const { rows: keyNumbers, stats: vs } = verifyKeyNumbers(llmNumbers, texts);
  doc.keyNumbers = keyNumbers;
  emit(`주요 수치 원문 대조: ${vs.rowsChecked}행 확인 · 근거 없는 인용 ${vs.droppedCitations}개 제거 · 새 충돌 ${vs.newConflicts}건`);
  const stamp = new Date().toISOString();
  writePage(doc, "주요-수치", renderNumbersPage(keyNumbers, filename, stamp));
  const overviewBody = ov?.markdown ? stripFm(ov.markdown) : `# 개요\n\n> ${filename} (${totalPages}쪽)\n\n${notes.map((n) => `- ${n.summary}`).join("\n")}\n`;
  writePage(
    doc,
    "overview",
    buildFrontmatter({ title: "개요", type: "overview", summary: overviewSummary(ov?.summary, overviewBody, filename), sources: extractCitations(overviewBody), updated: stamp }) + overviewBody,
  );
  // deterministic citation grounding for every topic page (주요-수치 is verified separately above)
  const rg = regroundPages(doc, texts);
  emit(`본문 수치 인용 원문 대조: ${rg.groups}개 인용 확인 · ${rg.fixed}개에 실제 출처 쪽 추가`);
  rebuildIndex(doc);
  opts.signal?.throwIfAborted();
  return { usage, ms: Date.now() - t0 };
}

function overviewSummary(s: string | undefined, body: string, filename: string): string {
  if (s && s.length >= 12 && !/개요 작성|요약 작성/.test(s)) return s;
  const q = body.match(/^>\s*(?:한 줄 요약:\s*)?(.+)$/m)?.[1];
  return q ? (q.length > 70 ? q.slice(0, 68) + "…" : q) : `${filename} 전체 요약`;
}

const stripFm = (md: string) => parseFrontmatter(md.trim()).body.trim() + "\n";

function factsSection(title: string, facts: Fact[], withTitle: boolean): string {
  const bullets = facts.map((f) => `- ${f.claim} (p.${f.pages.join(", p.")})`).join("\n");
  return withTitle ? `# ${title}\n\n> ${facts[0]?.claim ?? ""}\n\n## 내용\n${bullets}\n` : `## 추가 내용\n${bullets}\n`;
}

/** Apply a writer op with a data-loss guard. Returns the effective action. */
function applyOp(
  doc: WikiDoc,
  slug: string,
  m: { title: string; type: PageType },
  existing: string | null,
  op: WriteOp,
  facts: Fact[],
  pageCount: number,
  prevSummary?: string,
): "create" | "update" | "append" | "skip" {
  let body: string;
  let action = op.action;
  const md = stripFm(op.markdown || "");
  if (!existing && action !== "create") action = "create";
  if (action === "skip") {
    if (!existing) return "skip";
    // still verify the new facts' pages are cited somewhere; otherwise append them
    const cited = new Set(extractCitations(existing));
    const missing = facts.filter((f) => !f.pages.some((p) => cited.has(p)));
    if (!missing.length) return "skip";
    body = existing.trimEnd() + "\n\n" + factsSection(m.title, missing, false);
    action = "append";
  } else if (action === "append") {
    body = existing!.trimEnd() + "\n\n" + md;
  } else if (action === "update" && existing) {
    // guard: an update must not drop a large part of what was already cited
    const before = new Set(extractCitations(existing));
    const after = new Set(extractCitations(md));
    const lost = [...before].filter((p) => !after.has(p));
    if (before.size >= 3 && lost.length / before.size > 0.3) {
      body = existing.trimEnd() + "\n\n" + factsSection(m.title, facts, false);
      action = "append";
    } else body = md;
  } else body = md;

  if (!body.trim()) return "skip";
  if (!/^#\s/m.test(body)) body = `# ${op.title || m.title}\n\n${body}`;
  const sources = extractCitations(body).filter((p) => p <= pageCount);
  writePage(
    doc,
    slug,
    // index.md is a catalog of what each page IS — keep the page summary when the writer described its edit instead
    buildFrontmatter({ title: op.title || m.title, type: m.type, summary: pageSummary(op.summary, prevSummary, body), sources, updated: new Date().toISOString() }) + body,
  );
  return action;
}

function renderNumbersPage(rows: KeyNumber[], filename: string, stamp: string): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const conflicts = rows.filter((r) => r.conflict);
  const body = `# 주요 수치

> ${filename}에 나오는 핵심 수치 ${rows.length}개${conflicts.length ? ` · 문서 안 값 충돌 ${conflicts.length}건` : ""}. 심사·리포트에서 일관성 검사에 쓴다.

| 항목 | 값 | 출처 | 비고 |
|---|---|---|---|
${rows.map((r) => `| ${esc(r.metric)} | ${r.conflict ? "⚠ " : ""}${esc(r.value)} | ${r.pages.length ? `(p.${compactPages(r.pages).replace(/, /g, ", p.")})` : "-"} | ${esc(r.note)} |`).join("\n")}
${conflicts.length ? `\n## 문서 안 충돌\n${conflicts.map((r) => `- **[불일치]** ${r.metric}: ${r.value} (p.${r.pages.join(", p.")}) — ${r.note}`).join("\n")}\n` : ""}
관련: [[overview]] · [[index]]
`;
  return buildFrontmatter({ title: "주요 수치", type: "numbers", summary: `핵심 수치 ${rows.length}개 표(출처 포함)`, sources: extractCitations(body), updated: stamp }) + body;
}

/** Re-ground figure citations on all content pages (not 주요-수치/meta) against the raw pages; fix delta summaries. */
function regroundPages(doc: WikiDoc, raw: string[]) {
  const tot = { groups: 0, fixed: 0, added: 0, summaries: 0, pages: 0 };
  for (const p of listPages(doc)) {
    if (p.type === "numbers" || p.type === "meta") continue;
    const md = readPage(doc, p.slug);
    if (!md) continue;
    const { fm, body } = parseFrontmatter(md);
    const r = regroundCitations(body, raw);
    const summary = pageSummary(fm.summary, undefined, r.body);
    tot.groups += r.stats.groups;
    tot.fixed += r.stats.fixed;
    tot.added += r.stats.added;
    if (!r.stats.fixed && summary === (fm.summary ?? "")) continue;
    if (summary !== (fm.summary ?? "")) tot.summaries++;
    tot.pages++;
    const sources = extractCitations(r.body).filter((n) => n <= raw.length);
    writePage(doc, p.slug, buildFrontmatter({ ...fm, summary, sources }) + r.body);
  }
  return tot;
}

