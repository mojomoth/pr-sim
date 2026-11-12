"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { GLOBAL_DECISIONS, POC_ITEMS, UPDATED_AT, type HilPoc, type Tone } from "../lib/pocs-data";
import { progressOf, resetAll, updatePoc, useHilState, useStorageOk, type HilState, type Verdict } from "../lib/store";
import { ProviderStatus } from "./ProviderStatus";

const VERDICTS: { id: Verdict; label: string }[] = [
  { id: "ok", label: "좋아요" },
  { id: "fix", label: "수정 필요" },
  { id: "hold", label: "보류" },
];
const VERDICT_LABEL: Record<Verdict, string> = { ok: "좋아요", fix: "수정 필요", hold: "보류" };

function ToneChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls =
    tone === "pass"
      ? "bg-ink text-inverse"
      : tone === "warn"
        ? "bg-canvas text-ink ring-1 ring-inset ring-ink"
        : "bg-canvas text-error ring-1 ring-inset ring-error";
  const mark = tone === "pass" ? "통과" : tone === "warn" ? "확인 필요" : "실패";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold leading-[18px] ${cls}`}>
      <span className="sr-only">{mark}: </span>
      {children}
    </span>
  );
}

function Check({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border-2 ${checked ? "border-ink bg-ink text-inverse" : "border-ink/40 bg-canvas"}`}
    >
      {checked && (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      )}
    </span>
  );
}

function toMarkdown(s: HilState) {
  const lines = [`# PR-SIM PoC HIL 피드백`, ``, `작성: ${new Date().toLocaleString("ko-KR")}`, ``];
  for (const p of POC_ITEMS) {
    const pr = progressOf(s, p.key);
    lines.push(`## ${p.title} (${p.href ?? "-"})`);
    lines.push(`- 판단: ${pr.verdict ? VERDICT_LABEL[pr.verdict] : "미정"}`);
    lines.push(`- 체크: ${pr.checked.length} / ${p.steps.length}`);
    const unchecked = p.steps.filter((st) => !pr.checked.includes(st.id));
    if (unchecked.length) lines.push(`- 아직 안 해 본 항목: ${unchecked.map((st) => st.id).join(", ")}`);
    lines.push(`- 피드백:`, pr.feedback.trim() ? pr.feedback.trim().split("\n").map((l) => `  > ${l}`).join("\n") : "  (없음)", ``);
  }
  return lines.join("\n");
}

function PocCard({ poc, state }: { poc: HilPoc; state: HilState }) {
  const pr = progressOf(state, poc.key);
  const done = pr.checked.length;
  const toggle = (id: string) =>
    updatePoc(poc.key, (p) => ({ ...p, checked: p.checked.includes(id) ? p.checked.filter((x) => x !== id) : [...p.checked, id] }));

  return (
    <section id={`poc-${poc.key}`} aria-labelledby={`h-${poc.key}`} className="scroll-mt-28 rounded-[28px] bg-surface p-5 sm:p-6 flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-secondary tabular">pocs/{poc.key}</span>
          <ToneChip tone={poc.verdict.tone}>{poc.verdict.label}</ToneChip>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h2 id={`h-${poc.key}`} className="text-[28px] leading-9 font-bold tracking-[-0.8px]">
            {poc.title}
          </h2>
          {poc.href && (
            <Link
              href={poc.href}
              target="_blank"
              className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-[20px] bg-ink px-6 font-semibold text-inverse"
            >
              {poc.href} 열기 <span aria-hidden>→</span>
            </Link>
          )}
        </div>
        <p className="text-sm leading-5 text-secondary">요구사항 · {poc.requirement}</p>
      </header>

      <p className="leading-6">{poc.summary}</p>
      <p className="text-xs leading-[18px] text-secondary">리뷰 이력 · {poc.trail}</p>

      {poc.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {poc.links.map((l) => (
            <Link key={l.href} href={l.href} target="_blank" className="inline-flex min-h-11 items-center rounded-full bg-canvas px-4 text-sm font-semibold">
              {l.label} <span aria-hidden className="ml-1">↗</span>
            </Link>
          ))}
        </div>
      )}

      {poc.remaining.length > 0 && (
        <div className="rounded-[20px] bg-canvas p-4 flex flex-col gap-2">
          <h3 className="text-sm font-semibold">남은 이슈 {poc.remaining.length}건</h3>
          <ul className="flex flex-col gap-1.5 text-sm leading-5 text-secondary list-disc pl-5">
            {poc.remaining.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xl leading-7 font-semibold tracking-[-0.4px]">해 볼 것</h3>
          <span className="tabular text-sm text-secondary" aria-live="polite">
            {done} / {poc.steps.length}
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {poc.steps.map((st, i) => {
            const checked = pr.checked.includes(st.id);
            return (
              <li key={st.id} className="flex items-start gap-1">
                <label className="flex min-h-11 flex-1 cursor-pointer items-start gap-3 rounded-[16px] px-2 py-2.5 hover:bg-canvas">
                  <input type="checkbox" className="sr-only peer" checked={checked} onChange={() => toggle(st.id)} />
                  <span className="peer-focus-visible:outline-2 peer-focus-visible:outline-ink peer-focus-visible:outline-offset-2 rounded-[8px] inline-flex">
                    <Check checked={checked} />
                  </span>
                  <span className={`leading-6 ${checked ? "text-secondary line-through decoration-1" : ""}`}>
                    <span className="tabular text-secondary mr-1">{i + 1}.</span>
                    {st.text}
                  </span>
                </label>
                {st.href && (
                  <Link
                    href={st.href}
                    target="_blank"
                    aria-label={`${i + 1}번 항목 화면 열기`}
                    className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold"
                  >
                    ↗
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {poc.decisions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">결정이 필요한 사항</h3>
          <ul className="flex flex-col gap-2">
            {poc.decisions.map((d) => (
              <li key={d} className="rounded-[16px] bg-canvas px-4 py-3 text-sm leading-5">
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="group rounded-[20px] bg-canvas px-4 py-3">
        <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-sm font-semibold">
          알려진 한계 {poc.limitations.length}건
          <span aria-hidden className="transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-5 text-secondary list-disc pl-5">
          {poc.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-secondary">
          자세한 내용: <code className="tabular">{poc.readme}</code>
        </p>
      </details>

      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <h3 className="text-sm font-semibold" id={`v-${poc.key}`}>
          내 판단
        </h3>
        <div role="radiogroup" aria-labelledby={`v-${poc.key}`} className="flex flex-wrap gap-2">
          {VERDICTS.map((v) => {
            const on = pr.verdict === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => updatePoc(poc.key, (p) => ({ ...p, verdict: on ? null : v.id }))}
                className={`h-11 rounded-full px-5 text-sm font-semibold ${on ? "bg-ink text-inverse" : "bg-canvas text-ink"}`}
              >
                {v.label}
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold">피드백</span>
          <textarea
            value={pr.feedback}
            onChange={(e) => updatePoc(poc.key, (p) => ({ ...p, feedback: e.target.value }))}
            rows={4}
            placeholder="느낀 점, 버그, 바꾸고 싶은 점을 자유롭게 적어 주세요."
            className="min-h-[104px] w-full resize-y rounded-[16px] border border-line bg-canvas px-4 py-3 leading-6 placeholder:text-secondary/70"
          />
        </label>
      </div>
    </section>
  );
}

export function HilChecklist() {
  const state = useHilState();
  const storageOk = useStorageOk();
  const [copied, setCopied] = useState<string | null>(null);

  const totals = useMemo(() => {
    const steps = POC_ITEMS.reduce((n, p) => n + p.steps.length, 0);
    const checked = POC_ITEMS.reduce((n, p) => n + progressOf(state, p.key).checked.filter((id) => p.steps.some((s) => s.id === id)).length, 0);
    const judged = POC_ITEMS.filter((p) => progressOf(state, p.key).verdict).length;
    return { steps, checked, judged };
  }, [state]);

  const copy = async () => {
    const md = toMarkdown(state);
    try {
      await navigator.clipboard.writeText(md);
      setCopied("Markdown으로 복사했어요");
    } catch {
      setCopied("복사하지 못했어요. JSON 다운로드를 이용해 주세요");
    }
    setTimeout(() => setCopied(null), 3000);
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), state }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prsim-hil-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const pct = totals.steps ? Math.round((totals.checked / totals.steps) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-[var(--gutter)] pb-40 flex flex-col gap-8">
      <header className="flex h-14 items-center justify-between gap-3">
        <Link href="/" aria-label="PoC 허브로" className="inline-flex items-center p-2 -ml-2">
          <Image src="/hil/lockup-black.png" alt="PR·SIM" width={103} height={32} className="h-8 w-auto" />
        </Link>
        <Link href="/devlog" className="inline-flex h-11 items-center rounded-full bg-surface px-4 text-sm font-semibold">
          개발 관측 →
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <p className="text-sm font-medium text-secondary">Proof of Concept · Human in the Loop</p>
        <h1 className="text-[28px] leading-9 sm:text-[40px] sm:leading-[48px] font-bold tracking-[-0.8px] sm:tracking-[-1.6px]">HIL 검증 체크리스트</h1>
        <p className="leading-6 text-secondary">
          PoC 7개와 공용 테스트 데이터를 직접 써 보고, 항목마다 체크하고 판단과 피드백을 남겨 주세요. 기록은 이 브라우저에만 저장돼요. 다 끝나면 아래
          &lsquo;피드백 복사&rsquo;로 한 번에 전달할 수 있어요.
        </p>
        <div className="mt-2 rounded-[20px] bg-surface p-4 flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">전체 진행</span>
            <span className="tabular text-sm text-secondary">
              체크 {totals.checked} / {totals.steps} · 판단 {totals.judged} / {POC_ITEMS.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="전체 체크 진행률">
            <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
          {!storageOk && <p className="text-sm text-error">이 브라우저에서는 저장이 막혀 있어요. 새로고침하면 체크와 피드백이 사라져요.</p>}
        </div>
        <p className="text-xs text-secondary">내용 기준일 {UPDATED_AT} · 각 PoC의 README와 리뷰 기록에서 정리했어요.</p>
      </section>

      <nav aria-label="PoC 바로가기" className="sticky top-0 z-10 -mx-[var(--gutter)] bg-canvas/95 backdrop-blur px-[var(--gutter)] py-2 border-b border-line">
        <ul className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {POC_ITEMS.map((p) => {
            const pr = progressOf(state, p.key);
            return (
              <li key={p.key} className="shrink-0">
                <a href={`#poc-${p.key}`} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface px-4 text-sm font-semibold whitespace-nowrap">
                  {p.title.replace(" (공용)", "")}
                  <span className="tabular text-xs font-medium text-secondary">
                    {pr.checked.length}/{p.steps.length}
                  </span>
                </a>
              </li>
            );
          })}
          <li className="shrink-0">
            <a href="#decisions" className="inline-flex h-11 items-center rounded-full bg-surface px-4 text-sm font-semibold whitespace-nowrap">
              결정 사항
            </a>
          </li>
        </ul>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProviderStatus />
        <section aria-labelledby="overview-h" className="rounded-[28px] bg-surface p-5 sm:p-6 flex flex-col gap-3">
          <h2 id="overview-h" className="text-xl leading-7 font-semibold tracking-[-0.4px]">PoC 현황</h2>
          <ul className="flex flex-col divide-y divide-line">
            {POC_ITEMS.map((p) => {
              const pr = progressOf(state, p.key);
              return (
                <li key={p.key}>
                  <a href={`#poc-${p.key}`} className="flex min-h-12 items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold truncate">{p.title}</span>
                      <span className="block text-xs text-secondary truncate">
                        {p.verdict.label} · 남은 이슈 {p.remaining.length}건
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block tabular text-sm">
                        {pr.checked.length}/{p.steps.length}
                      </span>
                      <span className="block text-xs text-secondary">{pr.verdict ? VERDICT_LABEL[pr.verdict] : "미판단"}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section id="decisions" aria-labelledby="dec-h" className="scroll-mt-28 flex flex-col gap-3">
        <h2 id="dec-h" className="text-[28px] leading-9 font-bold tracking-[-0.8px]">결정이 필요한 사항</h2>
        <p className="text-secondary leading-6">여러 PoC에 걸쳐 에이전트들이 올린 제품·기술 결정이에요. PoC별 결정은 각 카드 안에 있어요.</p>
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {GLOBAL_DECISIONS.map((d, i) => (
            <li key={d.title} className={`rounded-[20px] p-5 flex flex-col gap-2 ${i === 0 ? "bg-ink text-inverse md:col-span-2" : "bg-surface"}`}>
              <span className="font-semibold">
                <span className="tabular mr-1.5">{i + 1}.</span>
                {d.title}
              </span>
              <span className={`text-sm leading-5 ${i === 0 ? "text-inverse/80" : "text-secondary"}`}>{d.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      {POC_ITEMS.map((p) => (
        <PocCard key={p.key} poc={p} state={state} />
      ))}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 backdrop-blur pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex w-full max-w-[1120px] items-center gap-2 px-[var(--gutter)]">
          <button type="button" onClick={copy} className="h-14 flex-1 rounded-[20px] bg-ink px-4 font-semibold text-inverse">
            피드백 복사
          </button>
          <button type="button" onClick={download} className="h-14 rounded-[20px] bg-surface px-4 font-semibold">
            JSON
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("모든 체크와 피드백을 지울까요?")) resetAll();
            }}
            className="h-14 rounded-[20px] bg-surface px-4 font-semibold"
          >
            초기화
          </button>
        </div>
        <p aria-live="polite" className="mx-auto max-w-[1120px] px-[var(--gutter)] pt-1 text-center text-xs text-secondary min-h-[18px]">
          {copied ?? ""}
        </p>
      </div>
    </main>
  );
}
