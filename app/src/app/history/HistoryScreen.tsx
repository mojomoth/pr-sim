"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomBar, Button } from "@/components/Button";
import { Badge, ChipGroup } from "@/components/Chip";
import { ConfirmDialog } from "@/components/Dialog";
import { BrandHeader } from "@/components/Header";
import { Alert, Plus } from "@/components/Icons";
import { Screen } from "@/components/Layout";
import { deleteSession, listSessions } from "@/features/session/db";
import type { SessionRecord } from "@/features/session/types";
import { mmss } from "@/features/session/useCountdown";
import { cloneAsDraft } from "../setup/draft";

type Filter = "all" | "done" | "in_progress";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "done", label: "완료" },
  { value: "in_progress", label: "진행 중" },
];

const isDone = (r: SessionRecord) => r.status === "done";
const titleOf = (r: SessionRecord) => r.setup.situation.split("\n")[0].trim() || "제목 없는 발표";
const dateOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

/** Where 이어하기 goes for an unfinished session. */
function resumeHref(r: SessionRecord): string {
  if (r.status === "report") return `/result?s=${r.id}`;
  if (r.status === "qa" || r.resume?.phase === "qa") return `/qa?s=${r.id}`;
  return `/present?s=${r.id}`;
}

/** 07 · 목록 — 연습 기록, 결과 보기·다시 시작하기·이어하기, 삭제. */
export function HistoryScreen() {
  const router = useRouter();
  const [records, setRecords] = useState<SessionRecord[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [toDelete, setToDelete] = useState<SessionRecord | null>(null);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");

  const load = () =>
    listSessions().then(
      (all) => {
        setLoadError("");
        // Drafts still on the setup screen are not practice records yet.
        setRecords(all.filter((r) => r.status !== "setup"));
      },
      (e) => setLoadError(e instanceof Error ? e.message : "기록을 불러오지 못했어요."),
    );
  useEffect(() => {
    void load();
  }, []);

  const scores = (records ?? []).flatMap((r) => (isDone(r) && r.report ? [r.report.overall.total] : []));
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const shown = (records ?? []).filter((r) => filter === "all" || (filter === "done") === isDone(r));

  async function restart(r: SessionRecord) {
    setBusy(r.id);
    setActionError("");
    try {
      const draft = await cloneAsDraft(r);
      router.push(`/setup?s=${draft.id}`);
    } catch {
      // Storage errors (IndexedDB DOMException) are not user-facing copy.
      setActionError("다시 시작하지 못했어요. 다시 시도해 주세요.");
      setBusy("");
    }
  }

  async function remove() {
    if (!toDelete) return;
    const id = toDelete.id;
    setToDelete(null);
    setActionError("");
    try {
      await deleteSession(id);
      setRecords((rs) => rs && rs.filter((r) => r.id !== id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "기록을 삭제하지 못했어요.");
    }
  }

  return (
    <>
      <Screen bottomPad={84}>
        {/* Draft 07's round profile button is left out on purpose: v1 has no accounts, so it would lead nowhere. Add it with profiles. */}
        <BrandHeader />

        <h1 className="mt-6 text-[42px] font-extrabold leading-[52px] tracking-[-1.4px]">
          쌓이는 연습,
          <br />
          달라지는 발표.
        </h1>
        <p className="mt-2 text-[18px] font-medium text-secondary">나의 시뮬레이션 기록</p>

        <dl className="mt-6 grid grid-cols-2 gap-2.5">
          <div className="flex items-baseline justify-center gap-1.5 rounded-[20px] bg-surface py-2">
            <dt className="text-[17px] font-medium">총</dt>
            <dd className="text-[28px] font-bold leading-9 tracking-[-0.8px] tabular">
              {records?.length ?? "–"}
              <span className="ml-1 text-[17px] font-medium">회</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-center gap-1.5 rounded-[20px] bg-surface py-2">
            <dt className="text-[17px] font-medium">평균</dt>
            <dd className="text-[28px] font-bold leading-9 tracking-[-0.8px] tabular">
              {avg ?? "–"}
              <span className="ml-1 text-[17px] font-medium">점</span>
            </dd>
          </div>
        </dl>

        <ChipGroup className="mt-6" size="sm" label="기록 필터" value={filter} onChange={setFilter} options={FILTERS} />

        {actionError && (
          <p className="mt-4 flex items-start gap-2 rounded-[16px] border border-error/40 px-4 py-3 text-[14px] leading-5" role="alert">
            <Alert size={18} className="mt-0.5 shrink-0 text-error" />
            {actionError}
          </p>
        )}

        {loadError ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-[28px] border border-dashed border-line p-8 text-center" role="alert">
            <p className="text-[15px] leading-[22px] text-secondary">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              다시 불러오기
            </Button>
          </div>
        ) : records === null ? (
          <p className="mt-10 text-center text-[15px] text-secondary" role="status">
            불러오는 중…
          </p>
        ) : records.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-2 rounded-[28px] border border-dashed border-line px-6 py-10 text-center">
            <p className="text-[17px] font-semibold">아직 연습 기록이 없어요</p>
            <p className="text-[14px] leading-5 text-secondary">첫 시뮬레이션을 마치면 점수와 피드백이 여기에 쌓여요.</p>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-3" aria-label="시뮬레이션 기록">
            {shown.length === 0 && <li className="rounded-[28px] border border-dashed border-line p-8 text-center text-[15px] text-secondary">해당하는 기록이 없어요.</li>}
            {shown.map((r) => {
              const title = titleOf(r);
              const score = isDone(r) ? r.report?.overall.total : undefined;
              return (
                <li key={r.id} className="ui-enter rounded-[28px] bg-surface p-5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[14px] text-secondary tabular">{dateOf(r.createdAt)}</span>
                    {isDone(r) ? (
                      <Badge>완료</Badge>
                    ) : (
                      // Draft 07 shows 진행 중 lighter than the 완료 badge; ink/60 on the card (≈#6c6c6c) still clears 4.5:1 with white text.
                      <span className="inline-flex h-6 items-center rounded-full bg-ink/60 px-2.5 text-[12px] font-semibold leading-[18px] text-inverse">진행 중</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setToDelete(r)}
                      className="-mr-2 ml-auto inline-flex h-11 items-center rounded-full px-3 text-[14px] font-medium text-secondary hover:bg-card hover:text-ink"
                      aria-label={`${title} 기록 삭제`}
                    >
                      삭제
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[20px] font-semibold leading-7 tracking-[-0.4px]">{title}</p>
                      <p className="mt-0.5 text-[14px] text-secondary tabular">
                        발표 {r.setup.presentationMinutes}분 · 질의응답 {r.setup.qaMinutes}분
                      </p>
                    </div>
                    {score !== undefined && (
                      <p className="shrink-0 border-l border-line pl-4 tabular" aria-label={`${score}점`}>
                        <span className="text-[38px] font-extrabold leading-10 tracking-[-1.2px]">{score}</span>
                        <span className="text-[16px] font-semibold">점</span>
                      </p>
                    )}
                  </div>
                  {/* Not in draft 07: kept as a quiet one-line summary of the result. */}
                  {isDone(r) && r.report?.overall.headline && <p className="mt-1.5 line-clamp-1 text-[14px] leading-5 text-secondary">{r.report.overall.headline}</p>}
                  {/* Not in draft 07: where the unfinished session stopped, kept above the full-width 이어하기. */}
                  {!isDone(r) && r.resume && (
                    <p className="mt-1.5 text-[14px] leading-5 text-secondary tabular">
                      {r.resume.phase === "qa" ? "질의응답" : "발표"} {mmss(r.resume.remainingSec)} 남음
                    </p>
                  )}
                  {/* Draft 07 buttons are ~36px; h-11 keeps the 44px tap target. 결과 보기 : 다시 시작하기 ≈ 63 : 37 as drafted. */}
                  {isDone(r) ? (
                    <div className="mt-4 grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-2">
                      <Button href={`/result?s=${r.id}`} size="md" arrow className="h-11! rounded-[14px]" aria-label={`${title} 결과 보기`}>
                        결과 보기
                      </Button>
                      <Button onClick={() => void restart(r)} disabled={busy === r.id} size="md" variant="outline" className="h-11! rounded-[14px] px-2! text-[15px]! font-medium! text-secondary!" aria-label={`${title} 다시 시작하기`}>
                        {busy === r.id ? "준비 중…" : "다시 시작하기"}
                      </Button>
                    </div>
                  ) : (
                    <Button href={resumeHref(r)} size="md" arrow className="mt-4 h-11! w-full rounded-[14px]" aria-label={`${title} 이어하기`}>
                      이어하기
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Screen>

      <BottomBar line={false} fade>
        <Button href="/setup">
          <Plus size={20} /> 새 시뮬레이션
        </Button>
      </BottomBar>

      <ConfirmDialog
        open={!!toDelete}
        title="이 기록을 삭제할까요?"
        body="발표 내용, 질의응답, 결과가 모두 지워지고 되돌릴 수 없어요."
        confirmLabel="삭제하기"
        cancelLabel="취소"
        onConfirm={() => void remove()}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
