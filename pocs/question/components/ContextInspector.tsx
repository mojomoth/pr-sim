"use client";
import type { ContextPack } from "../lib/types";
import { ms, Stat, Tag } from "./ui";

type PackView = Omit<ContextPack, "text"> & { preview: string };

const KIND_LABEL = { mismatch: "자료 간 불일치", gap: "근거 공백", claim: "발표 주장", "number-conflict": "수치 차이" } as const;
const PURPOSE_LABEL = { claim: "전사 주장", risk: "리스크", numbers: "주요 수치" } as const;

export function ContextInspector({ pack, assignments, judgeName }: { pack: PackView; assignments?: { judgeId: string; targetIds: string[] }[]; judgeName: (id: string) => string }) {
  const full = pack.fullTextChars.presentation + pack.fullTextChars.proposal + pack.fullTextChars.transcript;
  const owner = new Map<string, string>();
  assignments?.forEach((a) => a.targetIds.forEach((t) => owner.set(t, judgeName(a.judgeId))));
  return (
    <div className="space-y-4" data-testid="context-inspector">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="컨텍스트" value={`${pack.chars.toLocaleString()}자`} sub={`≈${pack.approxTokens.toLocaleString()} 토큰`} />
        <Stat label="원문 전체 대비" value={full ? `${((pack.chars / full) * 100).toFixed(1)}%` : "–"} sub={`전체 ${full.toLocaleString()}자`} />
        <Stat label="위키 질의" value={`${pack.queries.length}건`} sub={`원문 ${pack.rawPages.length}쪽`} />
        <Stat label="구성 시간" value={ms(pack.ms)} sub={pack.lint.used ? `lint ${pack.lint.cached ? "캐시" : ms(pack.lint.ms)} · ${pack.lint.issues}건` : "lint 생략"} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">섹션별 크기</h3>
        <ul className="space-y-1.5">
          {pack.sections.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-secondary">{s.title}</span>
              <span className="tabular w-20 text-right">{s.chars.toLocaleString()}자</span>
              <span className="h-2 w-20 overflow-hidden rounded-full bg-line" aria-hidden>
                <span className="block h-full bg-ink" style={{ width: `${Math.min(100, (s.chars / pack.chars) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">검토 포인트 {pack.targets.length}개 (심사위원 배정)</h3>
        <ul className="space-y-2">
          {pack.targets.map((t) => (
            <li key={t.id} className="rounded-[16px] bg-canvas px-3 py-2 text-sm" data-testid="target">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="tabular font-semibold">{t.id}</span>
                <Tag tone={t.severity === "high" ? "ink" : "line"}>{KIND_LABEL[t.kind]} · {t.severity}</Tag>
                {owner.get(t.id) ? <Tag>{owner.get(t.id)}</Tag> : null}
                {t.unverifiedNumbers?.length ? <Tag tone="error">원문에 없는 수치 {t.unverifiedNumbers.length}</Tag> : null}
                {t.refs.filter((r) => r.pages.length).map((r, i) => (
                  <span key={i} className="text-xs text-secondary">
                    {r.doc === "presentation" ? "발표" : r.doc === "proposal" ? "제안" : "전사"} p.{r.pages.join(",")}
                  </span>
                ))}
              </div>
              <p className="break-words text-secondary">{t.detail}</p>
            </li>
          ))}
        </ul>
      </div>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">위키 질의 {pack.queries.length}건 (lexical, LLM 0회)</summary>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-secondary">
              <tr>
                <th className="py-1 pr-2 font-medium">문서</th>
                <th className="py-1 pr-2 font-medium">목적</th>
                <th className="py-1 pr-2 font-medium">질의</th>
                <th className="py-1 pr-2 font-medium">위키 페이지</th>
                <th className="py-1 text-right font-medium">자/ms</th>
              </tr>
            </thead>
            <tbody>
              {pack.queries.map((q, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="py-1 pr-2">{q.doc === "presentation" ? "발표" : "제안"}</td>
                  <td className="py-1 pr-2">{PURPOSE_LABEL[q.purpose]}</td>
                  <td className="max-w-[220px] py-1 pr-2">{q.query}</td>
                  <td className="py-1 pr-2">
                    {q.pages.map((p) => (
                      <a key={p} href={`/wiki?doc=${q.docId}&page=${encodeURIComponent(p)}`} target="_blank" rel="noreferrer" className="mr-1 underline underline-offset-2">
                        {p}
                      </a>
                    ))}
                  </td>
                  <td className="tabular py-1 text-right">
                    {q.contextChars}/{q.ms}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">근거용 원문 쪽 {pack.rawPages.length}개</summary>
        <div className="flex flex-wrap gap-1.5">
          {pack.rawPages.map((r) => (
            <span key={`${r.doc}${r.page}`} title={r.reason} className="rounded-full bg-canvas px-2.5 py-1 text-xs">
              {r.doc === "presentation" ? "발표" : "제안"} p.{r.page} <span className="text-secondary">· {r.chars}자{r.score ? ` · ${r.score}점` : ""}</span>
            </span>
          ))}
        </div>
      </details>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">심사위원에게 들어간 전체 컨텍스트 보기</summary>
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-[16px] bg-canvas p-3 text-xs leading-5" data-testid="context-preview">
          {pack.preview}
        </pre>
      </details>
    </div>
  );
}
