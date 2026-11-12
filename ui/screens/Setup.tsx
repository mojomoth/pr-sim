"use client";
import { useRouter } from "next/navigation";
import { useId } from "react";
import type { Temperament } from "@/lib/types";
import { BottomBar, Button } from "../components/Button";
import { BrandHeader, HeaderPill } from "../components/Header";
import { Plus } from "../components/Icons";
import { JudgeAvatar, JudgeRow } from "../components/JudgeCard";
import { Screen } from "../components/Layout";
import { MinuteSlider } from "../components/Slider";
import { UploadRow } from "../components/UploadRow";
import { EXTRA_JUDGE_NAMES, MAX_JUDGES } from "../lib/mock";
import { countPages } from "../lib/pdf";
import { setFileBlob, setUiState, useUiState, type DocSlot, type FileMeta, type UiJudge } from "../lib/store";

const SAMPLE_FALLBACK: Record<DocSlot, FileMeta> = {
  presentation: { name: "패키징_발표.pdf", pages: 12, size: 2_480_000, sample: true },
  proposal: { name: "패키징_제안서.pdf", pages: 24, size: 4_100_000, sample: true },
};

/**
 * Load fixtures/<slot>.pdf through /api/ui/fixture and return it with its metadata (the caller keeps the blob,
 * so the presentation screen renders this exact file without re-downloading). Falls back to mock metadata.
 */
async function loadSample(slot: DocSlot): Promise<{ meta: FileMeta; blob: Blob | null }> {
  const check = (await fetch(`/api/ui/fixture?slot=${slot}&check=1`).then((r) => r.json())) as { exists: boolean };
  const res = check.exists ? await fetch(`/api/ui/fixture?slot=${slot}`) : null;
  if (!res?.ok) return { meta: SAMPLE_FALLBACK[slot], blob: null };
  const blob = await res.blob();
  const name = decodeURIComponent(res.headers.get("x-file-name") ?? `${slot}.pdf`);
  const pages = await countPages(blob);
  return { meta: { name, pages, size: blob.size, sample: true }, blob };
}

/** 02 · 상황 설정 — 상황, 시간 슬라이더 2개, PDF 업로드 2개, 심사위원 추가·삭제·페르소나 선택, 발표 시작. */
export function Setup() {
  const s = useUiState();
  const router = useRouter();
  const situationId = useId();
  const hintId = useId();

  const total = s.presentationMinutes + s.qaMinutes;
  const missing = [
    !s.situation.trim() && "상황을 입력해 주세요",
    !s.files.presentation && "발표 자료를 업로드해 주세요",
    s.judges.length === 0 && "심사위원을 1명 이상 추가해 주세요",
  ].filter(Boolean) as string[];
  const ready = missing.length === 0;

  const setFile = (slot: DocSlot, meta: FileMeta | undefined, blob?: Blob | null) => {
    setFileBlob(slot, blob ?? null);
    setUiState((p) => ({ files: { ...p.files, [slot]: meta } }));
  };
  const setJudges = (fn: (j: UiJudge[]) => UiJudge[]) => setUiState((p) => ({ judges: fn(p.judges) }));
  const addJudge = () =>
    setJudges((js) => {
      const used = new Set(js.map((j) => j.name));
      const name = EXTRA_JUDGE_NAMES.find((n) => !used.has(n)) ?? `심사위원 ${js.length + 1}`;
      const order: Temperament[] = ["friendly", "strict", "aggressive"];
      return [...js, { id: `j-${Date.now().toString(36)}`, name, temperament: order[js.length % 3], role: "투자심사위원 · 얼굴 생성 전" }];
    });
  const start = () => {
    if (!ready) return;
    setUiState({ lastRun: undefined, resume: undefined, viewRecord: undefined });
    router.push("/ui/presentation");
  };

  const footerSummary = (
    <p className="text-center text-[14px] font-medium text-secondary tabular" aria-live="polite" data-testid="setup-summary">
      총 {total}분 · 심사위원 {s.judges.length}명
    </p>
  );
  const hint = (id: string) =>
    !ready && (
    <p id={id} className="text-center text-[13px] leading-[18px] text-secondary">
      {missing[0]}
    </p>
  );

  return (
    <>
      <Screen width="wide" bottomPad={150} className="lg:pb-12">
        <BrandHeader backHref="/ui" />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[20px] font-bold leading-7 tracking-[-0.4px]">상황 설정</p>
          <HeaderPill label="3단계 중 1단계">
            01 <span className="ml-1 font-medium text-secondary">/ 03</span>
          </HeaderPill>
        </div>

        <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12">
          <main className="flex flex-col">
            <h1 className="text-[28px] font-bold leading-9 tracking-[-0.8px]">
              어떤 발표를
              <br />
              준비하고 있나요?
            </h1>
            <p className="mt-1.5 text-[16px] leading-6 text-secondary">발표 환경을 내 상황에 맞춰 설정하세요.</p>

            <div className="mt-7 flex flex-col gap-2">
              <label htmlFor={situationId} className="text-[16px] font-semibold">
                상황
              </label>
              <textarea
                id={situationId}
                rows={3}
                value={s.situation}
                onChange={(e) => setUiState({ situation: e.target.value })}
                placeholder={"예) 친환경 패키징 사업 제안\n투자 심사위원을 설득하는 발표"}
                className="min-h-[52px] w-full resize-none rounded-[16px] bg-surface px-5 py-4 text-[16px] leading-6 placeholder:text-secondary/70 focus:outline-2 focus:outline-ink"
                maxLength={300}
              />
              <p className="text-right text-[12px] text-secondary tabular">{s.situation.length} / 300</p>
            </div>

            <div className="mt-4 flex flex-col gap-6">
              <MinuteSlider label="발표 시간" min={1} max={30} value={s.presentationMinutes} onChange={(v) => setUiState({ presentationMinutes: v })} />
              <MinuteSlider label="질의응답 시간" min={1} max={20} value={s.qaMinutes} onChange={(v) => setUiState({ qaMinutes: v })} />
            </div>

            <div className="mt-8 flex flex-col gap-6">
              <UploadRow
                label="발표 자료"
                required
                value={s.files.presentation}
                onUploaded={(m, b) => setFile("presentation", m, b)}
                onRemove={() => setFile("presentation", undefined)}
                onSample={async () => {
                  const { meta, blob } = await loadSample("presentation");
                  setFile("presentation", meta, blob);
                }}
              />
              <UploadRow
                label="제안 자료"
                value={s.files.proposal}
                onUploaded={(m, b) => setFile("proposal", m, b)}
                onRemove={() => setFile("proposal", undefined)}
                onSample={async () => {
                  const { meta, blob } = await loadSample("proposal");
                  setFile("proposal", meta, blob);
                }}
              />
            </div>

            <section className="mt-9 flex flex-col gap-3" aria-labelledby="judges-h">
              <div className="flex items-center justify-between">
                <h2 id="judges-h" className="text-[20px] font-bold leading-7 tracking-[-0.4px]">
                  심사위원 <span className="text-secondary tabular">{s.judges.length}</span>
                </h2>
                <button
                  type="button"
                  onClick={addJudge}
                  disabled={s.judges.length >= MAX_JUDGES}
                  className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface px-4 text-[15px] font-semibold hover:bg-card disabled:text-secondary"
                >
                  <Plus size={18} /> 추가
                </button>
              </div>
              {s.judges.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-line px-6 py-8 text-center">
                  <p className="text-[15px] text-secondary">아직 심사위원이 없어요.</p>
                  <Button size="sm" variant="secondary" onClick={addJudge}>
                    <Plus size={16} /> 심사위원 추가
                  </Button>
                </div>
              ) : (
                <ul className="flex flex-col gap-2.5" aria-label="심사위원 목록">
                  {s.judges.map((j) => (
                    <JudgeRow
                      key={j.id}
                      judge={j}
                      onChange={(t) => setJudges((js) => js.map((x) => (x.id === j.id ? { ...x, temperament: t } : x)))}
                      onRemove={() => setJudges((js) => js.filter((x) => x.id !== j.id))}
                    />
                  ))}
                </ul>
              )}
              <p className="text-[12px] leading-[18px] text-secondary">
                한 명당 하나의 성향을 가져요. 최대 {MAX_JUDGES}명 (임시 상한). 새로 추가한 심사위원의 얼굴은 심사위원 생성 단계에서 만들어져요.
              </p>
            </section>
          </main>

          {/* Desktop summary column */}
          <aside className="sticky top-6 hidden flex-col gap-5 rounded-[28px] bg-surface p-6 lg:flex" aria-label="설정 요약">
            <p className="text-[14px] font-medium text-secondary">설정 요약</p>
            <p className="whitespace-pre-line text-[20px] font-semibold leading-7 tracking-[-0.4px]">{s.situation.trim() || "상황을 입력해 주세요"}</p>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-[20px] bg-canvas p-4">
                <dt className="text-[13px] text-secondary">발표</dt>
                <dd className="text-[24px] font-bold tabular">{s.presentationMinutes}분</dd>
              </div>
              <div className="rounded-[20px] bg-canvas p-4">
                <dt className="text-[13px] text-secondary">질의응답</dt>
                <dd className="text-[24px] font-bold tabular">{s.qaMinutes}분</dd>
              </div>
            </dl>
            <ul className="flex flex-col gap-1.5 text-[14px]">
              <li className="flex justify-between gap-3">
                <span className="text-secondary">발표 자료</span>
                <span className="truncate font-medium">{s.files.presentation ? `${s.files.presentation.name} · ${s.files.presentation.pages}p` : "없음 (필수)"}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-secondary">제안 자료</span>
                <span className="truncate font-medium">{s.files.proposal ? `${s.files.proposal.name} · ${s.files.proposal.pages}p` : "없음"}</span>
              </li>
            </ul>
            <div className="flex -space-x-2">
              {s.judges.map((j) => (
                <div key={j.id} className="rounded-full ring-2 ring-surface">
                  <JudgeAvatar judge={j} size={44} secondary />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-line pt-5">
              {footerSummary}
              <Button onClick={start} disabled={!ready} arrow aria-describedby={ready ? undefined : `${hintId}-d`}>
                발표 시작하기
              </Button>
              {hint(`${hintId}-d`)}
            </div>
          </aside>
        </div>
      </Screen>

      <BottomBar desktopHidden>
        {footerSummary}
        <Button onClick={start} disabled={!ready} arrow aria-describedby={ready ? undefined : hintId}>
          발표 시작하기
        </Button>
        {hint(hintId)}
      </BottomBar>
    </>
  );
}
