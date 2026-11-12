"use client";
import { Fragment, type ReactNode } from "react";
import { compactPages, parseCitationGroup, parseFrontmatter } from "../lib/markdown";

// Minimal, safe markdown renderer for wiki pages (no HTML injection).
// Supports headings, blockquotes, bullet/numbered lists, tables, paragraphs, **bold**, _em_, `code`,
// [[wikilinks]] (clickable) and (p.N) citations (clickable → raw page).

export interface MdHandlers {
  onLink?: (slug: string) => void;
  /** page = the page to open; group = every page of the citation it came from (the raw sheet steps through them). */
  onCite?: (page: number, group?: number[]) => void;
  knownSlugs?: Set<string>;
}

const INLINE_RE = /(\[\[[^\]\n]+\]\]|\(\s*p{1,2}\.\s*\d+(?:\s*[–\-~,]\s*(?:p{1,2}\.\s*)?\d+)*\s*\)|\*\*[^*\n]+\*\*|\[(?:불일치|검토)\]|`[^`\n]+`|(?<![\p{L}\p{N}])_[^_\n]+_(?![\p{L}\p{N}]))/gu;

function normalize(s: string) {
  return s
    .normalize("NFC")
    .trim()
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export function Inline({ text, h }: { text: string; h: MdHandlers }): ReactNode {
  const parts = text.split(INLINE_RE);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("[[") && p.endsWith("]]")) {
      const [target, label] = p.slice(2, -2).split("|");
      const slug = normalize(target.split("#")[0]);
      const exists = !h.knownSlugs || h.knownSlugs.has(slug) || slug === "index" || slug === "log" || slug === "schema";
      return (
        <button
          key={i}
          type="button"
          onClick={() => h.onLink?.(slug)}
          className={`mx-[1px] rounded-md px-1 font-semibold underline decoration-1 underline-offset-[3px] hover:bg-surface ${exists ? "text-ink" : "text-secondary line-through"}`}
          title={exists ? `[[${slug}]] 열기` : "존재하지 않는 페이지"}
        >
          {label ?? target}
        </button>
      );
    }
    if (/^\(\s*p{1,2}\./.test(p)) {
      const pages = [...new Set(parseCitationGroup(p))].sort((a, b) => a - b);
      // Long groups: show the first pages as real chips + a "+N" chip. Never fake a continuous range —
      // (p.3, 5, 8, 30, 43) is not "p.3–43". Every chip opens the raw sheet with the whole group so each
      // cited page is one tap away.
      const SHOW = 4;
      const head = pages.length > SHOW + 1 ? pages.slice(0, SHOW) : pages;
      const rest = pages.length - head.length;
      const chip = "ml-0.5 rounded-full bg-surface px-1.5 py-[1px] text-[12px] font-medium text-secondary tabular hover:bg-card hover:text-ink";
      return (
        <span key={i} title={pages.length > 1 ? `출처 p.${compactPages(pages)}` : undefined}>
          {head.map((n) => (
            <button key={n} type="button" onClick={() => h.onCite?.(n, pages)} className={chip} aria-label={`원문 ${n}쪽 보기`}>
              p.{n}
            </button>
          ))}
          {rest > 0 && (
            <button
              type="button"
              onClick={() => h.onCite?.(pages[SHOW], pages)}
              className="ml-0.5 rounded-full border border-line bg-canvas px-1.5 py-[1px] text-[12px] font-semibold text-ink tabular hover:bg-surface"
              aria-label={`인용된 나머지 ${rest}쪽 보기: ${pages.slice(SHOW).join(", ")}쪽`}
              data-cite-more={pages.slice(SHOW).join(",")}
            >
              +{rest}쪽
            </button>
          )}
        </span>
      );
    }
    if ((p.startsWith("**") && p.endsWith("**")) || /^\[(불일치|검토)\]$/.test(p)) {
      const inner = p.startsWith("**") ? p.slice(2, -2) : p;
      const tag = /^\[(불일치|검토)\]$/.exec(inner);
      if (tag)
        return (
          <span key={i} className={`mr-1 rounded-md px-1.5 py-[1px] text-[12px] font-semibold ${tag[1] === "불일치" ? "bg-ink text-inverse" : "border border-line text-ink"}`}>
            {tag[1]}
          </span>
        );
      return <strong key={i}>{inner}</strong>;
    }
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded bg-surface px-1 text-[13px]">{p.slice(1, -1)}</code>;
    if (p.startsWith("_") && p.endsWith("_") && p.length > 2) return <em key={i} className="text-secondary">{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p.replace(/\[(검토|불일치)\]/g, "[$1]")}</Fragment>;
  });
}

type Block =
  | { k: "h"; level: number; text: string }
  | { k: "quote"; text: string }
  | { k: "ul" | "ol"; items: string[] }
  | { k: "table"; head: string[]; rows: string[][] }
  | { k: "p"; text: string };

function splitRow(l: string) {
  return l
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      out.push({ k: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (l.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ k: "quote", text: buf.join(" ") });
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push({ k: "table", head, rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push({ k: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      out.push({ k: "ol", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\s*[-*]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push({ k: "p", text: buf.join(" ") });
  }
  return out;
}

export function Markdown({ md, h, compact = false }: { md: string; h: MdHandlers; compact?: boolean }) {
  const { body } = parseFrontmatter(md);
  const blocks = parseBlocks(body);
  return (
    <div className={`break-keep text-[15px] leading-[24px] ${compact ? "space-y-2" : "space-y-3"}`}>
      {blocks.map((b, i) => {
        switch (b.k) {
          case "h":
            return b.level === 1 ? (
              <h2 key={i} className="pt-1 text-[22px] font-bold leading-[30px] tracking-[-0.6px]">
                <Inline text={b.text} h={h} />
              </h2>
            ) : b.level === 2 ? (
              <h3 key={i} className="pt-3 text-[17px] font-semibold leading-[26px] tracking-[-0.3px]">
                <Inline text={b.text} h={h} />
              </h3>
            ) : (
              <h4 key={i} className="pt-2 text-[15px] font-semibold">
                <Inline text={b.text} h={h} />
              </h4>
            );
          case "quote":
            return (
              <p key={i} className="rounded-[16px] bg-surface px-4 py-3 text-secondary">
                <Inline text={b.text} h={h} />
              </p>
            );
          case "ul":
          case "ol": {
            const L = b.k === "ul" ? "ul" : "ol";
            return (
              <L key={i} className={`space-y-1.5 pl-5 ${b.k === "ul" ? "list-disc" : "list-decimal"} marker:text-secondary`}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} h={h} />
                  </li>
                ))}
              </L>
            );
          }
          case "table":
            return (
              <div key={i} className="-mx-1 overflow-x-auto rounded-[16px] border border-line">
                <table className="w-full min-w-[480px] border-collapse text-[13px] leading-[19px]">
                  <thead className="bg-surface text-left">
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} className="px-3 py-2 font-semibold">
                          <Inline text={c} h={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="border-t border-line align-top">
                        {r.map((c, k) => (
                          <td key={k} className={`px-3 py-2 ${k === 1 ? `tabular font-medium ${c.length <= 16 ? "whitespace-nowrap" : "min-w-[160px]"}` : ""} ${b.head[k]?.trim() === "출처" ? "min-w-[148px]" : ""}`}>
                            <Inline text={c} h={h} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={i}>
                <Inline text={b.text} h={h} />
              </p>
            );
        }
      })}
    </div>
  );
}
