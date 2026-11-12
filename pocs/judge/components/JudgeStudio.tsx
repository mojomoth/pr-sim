"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TEMPERAMENT_LABEL, type Temperament } from "@/lib/types";
import { JUDGE_ERROR_MESSAGE, type JudgeErrorKind } from "../lib/errors";
import { QUALITIES, QUALITY_LABEL, type ImageQuality, type JudgeRecord } from "../lib/model";
import { createJudge, fetchJudges, removeJudge, streamPanel, toUiError, type UiError } from "./api";
import { ErrorCard, JudgeCard, SkeletonCard } from "./JudgeCard";
import { JudgeDetail } from "./JudgeDetail";
import { IconBack, IconSparkle, IconUsers } from "./icons";

const TEMPERAMENTS: { t: Temperament; desc: string }[] = [
  { t: "friendly", desc: "격려하며 묻는" },
  { t: "strict", desc: "꼼꼼히 따지는" },
  { t: "aggressive", desc: "압박하며 반박하는" },
];

type Slot =
  | { key: string; state: "pending"; temperament: Temperament; quality: ImageQuality; startedAt: number; replaceId?: string }
  | { key: string; state: "error"; temperament: Temperament; quality: ImageQuality; error: UiError; replaceId?: string };

let seq = 0;
const newKey = () => `s${Date.now().toString(36)}${seq++}`;

export function JudgeStudio() {
  const [temperament, setTemperament] = useState<Temperament>("friendly");
  const [quality, setQuality] = useState<ImageQuality>("low");
  const [judges, setJudges] = useState<JudgeRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  // Judge ids with a regenerate request in flight. A ref (not state) so a fast double tap
  // is rejected synchronously, before React re-renders the disabled button.
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    fetchJudges()
      .then((j) => alive && setJudges(j))
      .catch((e) => alive && setListError(String(e?.message ?? e)))
      .finally(() => {
        if (!alive) return;
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const pending = slots.some((s) => s.state === "pending");
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [pending]);

  const settle = useCallback((key: string, result: { judge: JudgeRecord; replaceId?: string } | { error: UiError }, replaceId?: string) => {
    if (replaceId) inflight.current.delete(replaceId);
    if ("judge" in result) {
      const { judge, replaceId } = result;
      setSlots((s) => s.filter((x) => x.key !== key));
      setJudges((js) => {
        if (replaceId && js.some((j) => j.id === replaceId)) return js.map((j) => (j.id === replaceId ? judge : j));
        return [judge, ...js];
      });
      setOpenId((o) => (o && o === replaceId ? judge.id : o));
      setAnnounce(`${judge.fullName} 심사위원(${TEMPERAMENT_LABEL[judge.temperament]})이 생성됐어요.`);
    } else {
      setSlots((s) => s.map((x) => (x.key === key ? { ...x, state: "error" as const, error: result.error } : x)));
      setAnnounce(`생성 실패: ${result.error.title}`);
    }
  }, []);

  const generate = useCallback(
    (t: Temperament, q: ImageQuality, opts: { replaceId?: string; simulateError?: JudgeErrorKind; key?: string } = {}) => {
      if (opts.replaceId) {
        if (inflight.current.has(opts.replaceId)) return; // already regenerating this judge
        inflight.current.add(opts.replaceId);
      }
      const key = opts.key ?? newKey();
      const slot: Slot = { key, state: "pending", temperament: t, quality: q, startedAt: Date.now(), replaceId: opts.replaceId };
      setNow(Date.now());
      setSlots((s) => (s.some((x) => x.key === key) ? s.map((x) => (x.key === key ? slot : x)) : [slot, ...s]));
      createJudge({ temperament: t, quality: q, replaceId: opts.replaceId, simulateError: opts.simulateError })
        .then((judge) => settle(key, { judge, replaceId: opts.replaceId }, opts.replaceId))
        .catch((e) => settle(key, { error: toUiError(e) }, opts.replaceId));
    },
    [settle],
  );

  const generatePanel = useCallback(() => {
    const keys = TEMPERAMENTS.map(() => newKey());
    const startedAt = Date.now();
    setNow(startedAt);
    setSlots((s) => [...TEMPERAMENTS.map(({ t }, i) => ({ key: keys[i], state: "pending" as const, temperament: t, quality, startedAt })), ...s]);
    // Any slot still pending once the stream is over (thrown OR closed cleanly without a
    // judge/error event for it, e.g. server crash after "start") becomes an error card.
    const failPending = (err: UiError) =>
      setSlots((s) => s.map((x) => (keys.includes(x.key) && x.state === "pending" ? { ...x, state: "error" as const, error: err } : x)));
    streamPanel({ quality }, (ev) => {
      if (ev.type === "judge") settle(keys[ev.slot], { judge: ev.judge });
      else if (ev.type === "error") settle(keys[ev.slot], { error: ev.error });
    })
      .then(() => failPending({ kind: "server", message: "panel stream ended without a result for this slot", ...JUDGE_ERROR_MESSAGE.server }))
      .catch((e) => failPending(toUiError(e)));
  }, [quality, settle]);

  const del = useCallback(async (j: JudgeRecord) => {
    if (inflight.current.has(j.id)) return; // deleting mid-regenerate would resurrect it on completion
    setJudges((js) => js.filter((x) => x.id !== j.id));
    setOpenId((o) => (o === j.id ? null : o));
    setAnnounce(`${j.fullName} 심사위원을 삭제했어요.`);
    try {
      await removeJudge(j.id);
    } catch {
      setJudges((js) => [j, ...js]);
    }
  }, []);

  const regenerate = useCallback((j: JudgeRecord) => generate(j.temperament, quality, { replaceId: j.id }), [generate, quality]);

  const busyById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots) if (s.state === "pending" && s.replaceId) m.set(s.replaceId, s.startedAt);
    return m;
  }, [slots]);
  const newSlots = slots.filter((s) => !(s.state === "pending" && s.replaceId && judges.some((j) => j.id === s.replaceId)));
  const openJudge = judges.find((j) => j.id === openId) ?? null;
  const counts = useMemo(() => {
    const c = { male: 0, female: 0 };
    for (const j of judges) c[j.gender]++;
    return c;
  }, [judges]);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-[var(--gutter)] pb-16 break-keep">
      <header className="h-14 flex items-center justify-between">
        <Link href="/" className="h-11 w-11 -ml-2.5 inline-flex items-center justify-center rounded-full" aria-label="PoC 허브로 돌아가기">
          <IconBack />
        </Link>
        <div className="flex items-center gap-2 font-bold text-lg tracking-[-0.4px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/symbol.svg" alt="" className="w-6 h-6" /> PR·SIM
        </div>
        <Link href="/devlog" className="h-9 px-3 inline-flex items-center rounded-full bg-surface text-xs font-semibold">
          개발 관측
        </Link>
      </header>

      <div className="lg:grid lg:grid-cols-[400px_1fr] lg:gap-12 lg:items-start">
        {/* ── Controls ── */}
        <section className="pt-4 flex flex-col gap-6 lg:sticky lg:top-4" aria-labelledby="judge-title">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-secondary">심사위원 생성 · PoC</p>
            <span className="h-8 px-3 inline-flex items-center rounded-full bg-surface text-xs font-semibold tabular">gpt-image-2</span>
          </div>
          <div className="flex flex-col gap-2">
            <h1 id="judge-title" className="text-[28px] leading-9 font-bold tracking-[-0.8px]">
              어떤 심사위원을
              <br />
              만나 볼까요?
            </h1>
            <p className="text-secondary">성향만 고르면 얼굴·이름·나이·복장은 무작위로 만들어져요.</p>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-base font-semibold mb-3">성향</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="심사위원 성향">
              {TEMPERAMENTS.map(({ t, desc }) => {
                const on = t === temperament;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTemperament(t)}
                    data-testid={`chip-${t}`}
                    className={`min-h-[64px] rounded-[20px] px-2 py-2 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                      on ? "bg-ink text-inverse" : "bg-surface text-ink hover:bg-card"
                    }`}
                  >
                    <span className="font-semibold">{TEMPERAMENT_LABEL[t]}</span>
                    <span className={`text-xs ${on ? "text-inverse/80" : "text-secondary"}`}>{desc}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>


          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => generate(temperament, quality)}
              data-testid="btn-generate"
              className="h-14 rounded-[20px] bg-ink text-inverse font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
            >
              <IconSparkle /> {TEMPERAMENT_LABEL[temperament]} 심사위원 생성
            </button>
            <button
              type="button"
              onClick={generatePanel}
              data-testid="btn-panel"
              className="h-14 rounded-[20px] bg-surface text-ink font-semibold inline-flex items-center justify-center gap-2 hover:bg-card transition-colors"
            >
              <IconUsers /> 3명 한 번에 생성
              <span className="text-sm font-normal text-secondary">친절함·빡셈·공격적</span>
            </button>
            <p className="text-xs text-secondary leading-[18px]">
              성별(남/여), 나이(30–60대), 이름, 헤어, 안경, 복장, 배경, 조명은 서버에서 매번 무작위로 정해져요. 3명 생성은 성·이름이 겹치지 않고 성별·나이가 섞이도록 맞춰요.
            </p>
          </div>
        </section>

        {/* ── Gallery ── */}
        <section className="mt-10 lg:mt-4 flex flex-col gap-4" aria-labelledby="gallery-title">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <h2 id="gallery-title" className="text-xl font-semibold tracking-[-0.4px]">
                생성된 심사위원 <span className="tabular">{judges.length}</span>명
              </h2>
              {judges.length > 0 && (
                <p className="text-xs text-secondary tabular">
                  남성 {counts.male} · 여성 {counts.female}
                </p>
              )}
            </div>
          </div>

          <div className="sr-only" aria-live="polite">
            {announce}
          </div>

          {listError && <p className="text-sm text-error">목록을 불러오지 못했어요: {listError}</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4" data-testid="gallery">
            {newSlots.map((s) =>
              s.state === "pending" ? (
                <SkeletonCard key={s.key} temperament={s.temperament} quality={s.quality} elapsedMs={now - s.startedAt} />
              ) : (
                <ErrorCard
                  key={s.key}
                  temperament={s.temperament}
                  error={s.error}
                  onRetry={() => generate(s.temperament, s.quality, { key: s.key, replaceId: s.replaceId })}
                  onDismiss={() => setSlots((xs) => xs.filter((x) => x.key !== s.key))}
                />
              ),
            )}
            {judges.map((j) => {
              const started = busyById.get(j.id);
              return (
                <JudgeCard
                  key={j.id}
                  judge={j}
                  busy={started ? { elapsedMs: now - started } : null}
                  onOpen={() => setOpenId(j.id)}
                  onRegenerate={() => regenerate(j)}
                  onDelete={() => del(j)}
                />
              );
            })}
          </div>

          {loaded && judges.length === 0 && newSlots.length === 0 && (
            <div className="rounded-[28px] bg-surface p-6 flex flex-col gap-1 items-start" data-testid="empty">
              <p className="font-semibold">아직 심사위원이 없어요</p>
              <p className="text-sm text-secondary">성향을 고르고 생성을 눌러 보세요. 한 명에 약 10초 걸려요.</p>
            </div>
          )}
          {!loaded && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-[3/4] rounded-[28px] bg-surface animate-pulse" />
              ))}
            </div>
          )}

          <details className="mt-6 rounded-[20px] border border-line p-4 text-sm" data-testid="dev-errors">
            <summary className="cursor-pointer font-semibold">개발용 옵션 · 화질 · 오류 미리보기</summary>
            <div className="mt-3 flex items-center justify-between">
              <p className="font-semibold">이미지 화질</p>
              <p className="text-xs text-secondary">{QUALITY_LABEL[quality].eta}</p>
            </div>
            <div className="mt-2 flex gap-2 rounded-full bg-surface p-1" role="radiogroup" aria-label="이미지 화질 (개발용)" data-testid="quality">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  role="radio"
                  aria-checked={q === quality}
                  onClick={() => setQuality(q)}
                  className={`flex-1 h-10 rounded-full text-sm font-semibold transition-colors ${q === quality ? "bg-ink text-inverse" : "text-secondary hover:text-ink"}`}
                >
                  {QUALITY_LABEL[q].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-secondary">성향 외의 사용자 입력이 아니라 지연·품질 비교용 기술 옵션이에요. 기본은 빠름(low).</p>
            <p className="mt-4 font-semibold">오류 화면 미리보기</p>
            <p className="mt-1 text-xs text-secondary">API를 호출하지 않고 서버가 해당 오류를 흉내 내요.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["moderation", "rate_limit", "timeout", "server"] as JudgeErrorKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => generate(temperament, quality, { simulateError: k })}
                  className="h-11 px-4 rounded-full bg-surface font-semibold text-xs"
                  data-testid={`sim-${k}`}
                >
                  {k}
                </button>
              ))}
            </div>
          </details>
        </section>
      </div>

      <JudgeDetail
        judge={openJudge}
        busy={openJudge && busyById.has(openJudge.id) ? { elapsedMs: now - busyById.get(openJudge.id)! } : null}
        onClose={() => setOpenId(null)}
        onRegenerate={regenerate}
        onDelete={del}
      />
    </div>
  );
}
