"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { BottomBar, Button } from "@/components/Button";
import { ChipGroup } from "@/components/Chip";
import { BrandHeader, HeaderPill } from "@/components/Header";
import { Alert, Close, Plus, Refresh } from "@/components/Icons";
import { JudgeAvatar } from "@/components/JudgeCard";
import { Screen } from "@/components/Layout";
import { MinuteSlider } from "@/components/Slider";
import { UploadRow } from "@/components/UploadRow";
import { platform } from "@/platform";
import { ApiError, streamJudges } from "@/features/session/api";
import { blobKey, createSession, deleteBlob, getSession, listSessions, storeJudgeImage, storePdf, updateSession, useBlobUrl } from "@/features/session/db";
import type { DocRole, RollAvoid, SessionRecord, StoredDoc, StoredJudge, Temperament } from "@/features/session/types";
import { PDF_LIMITS, readPdf } from "@/features/slide/pdf";
import { MAX_DOC_CHARS, TEMPERAMENT_LABEL } from "@/server/types";
import { buildWiki, cloneAsDraft, DEFAULT_SETUP, fallbackJudge, hasProgress, latestDraft, onWikiChange, wikiProgress } from "./draft";

const MAX_JUDGES = 3;
const PRESENTATION_MIN = { min: 1, max: 20 };
const QA_MIN = { min: 1, max: 15 };
const SITUATION_MAX = 300;
const PERSONAS = (["friendly", "strict", "aggressive"] as const).map((value) => ({ value, label: TEMPERAMENT_LABEL[value] }));

const SAMPLE = {
  presentation: { url: "/samples/presentation.pdf", name: "샘플_리웨이브_발표자료.pdf" },
  proposal: { url: "/samples/proposal.pdf", name: "샘플_리웨이브_제안서.pdf" },
} as const;
const SAMPLE_SITUATION = "친환경 완충재 스타트업의 Pre-A 투자 유치\n투자 심사위원을 설득하는 발표";

type Resolved = { rec: SessionRecord } | { redirect: string } | { notFound: true };
const resolving = new Map<string, Promise<Resolved>>();

/**
 * Which draft /setup edits. No id → the latest draft (or a new one). A session that was opened but never
 * really started becomes a draft again; one with progress is copied into a new draft. Shared while in
 * flight so a double-mounted effect (Strict Mode) does not create two drafts.
 */
function resolveDraft(sid: string | null): Promise<Resolved> {
  const key = sid ?? "";
  let p = resolving.get(key);
  if (!p) {
    p = (async (): Promise<Resolved> => {
      if (!sid) return { redirect: ((await latestDraft()) ?? (await createSession(DEFAULT_SETUP))).id };
      const rec = await getSession(sid);
      if (!rec) return { notFound: true };
      if (rec.status === "setup") return { rec };
      if (rec.status === "presentation" && !hasProgress(rec)) return { rec: await updateSession(rec.id, { status: "setup" }) };
      return { redirect: (await cloneAsDraft(rec)).id };
    })().finally(() => resolving.delete(key));
    resolving.set(key, p);
  }
  return p;
}

/** Blob keys a session points at: judge photos and PDFs. */
const blobKeysOf = (r: SessionRecord) =>
  [...r.judges.flatMap((j) => [j.imageKey, j.thumbKey]), r.docs.presentation?.pdfKey, r.docs.proposal?.pdfKey].filter((k): k is string => !!k);

/** PDF keys an upload in this tab has stored but not yet saved into its session. */
const attaching = new Set<string>();

/**
 * Delete blobs a replaced / removed PDF or judge left behind. A key is kept while any session still
 * points at it (same file → same PDF key; a cloned draft shares its source's PDFs) or an upload is saving it.
 */
async function dropBlobs(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const inUse = new Set((await listSessions()).flatMap(blobKeysOf));
  await Promise.all(keys.filter((k) => !inUse.has(k) && !attaching.has(k)).map((k) => deleteBlob(k)));
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** 02 · 상황 설정 */
export function SetupScreen() {
  const sid = useSearchParams().get("s");
  const router = useRouter();
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (sid) return;
    resolveDraft(null).then(
      (r) => "redirect" in r && router.replace(`/setup?s=${r.redirect}`),
      (e) => setFailure(errorText(e, "기록을 불러오지 못했어요.")),
    );
  }, [sid, router]);

  if (sid) return <SetupForm key={sid} sid={sid} />;
  return <Shell>{failure ? <LoadFailure message={failure} /> : <Loading />}</Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Screen>
      <BrandHeader backHref="/" />
      {children}
    </Screen>
  );
}

function Loading() {
  return (
    <p className="mt-10 text-center text-[15px] text-secondary" role="status">
      불러오는 중…
    </p>
  );
}

function LoadFailure({ message, notFound }: { message: string; notFound?: boolean }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center" role="alert">
      <Alert size={28} className="text-secondary" />
      <p className="text-[20px] font-bold">{notFound ? "기록을 찾을 수 없어요" : "기록을 불러오지 못했어요"}</p>
      <p className="text-[15px] leading-[22px] text-secondary">{message}</p>
      <div className="mt-2 flex w-full flex-col gap-2">
        {notFound ? (
          <Button href="/setup">새로 설정하기</Button>
        ) : (
          <Button onClick={() => window.location.reload()}>다시 시도</Button>
        )}
        <Button href="/history" variant="secondary">
          연습 기록으로
        </Button>
      </div>
    </div>
  );
}

/** One judge row in the form. `faceTemperament` = the persona the current photo was made for. */
interface Slot {
  key: string;
  temperament: Temperament;
  judge?: StoredJudge;
  faceTemperament?: Temperament;
  pending?: boolean;
  error?: string;
  /** Server error code of the failure (several rows failing with the same code get one shared notice). */
  errorCode?: string;
}

/** The shared notice when every failed face has the same cause: only the image service is down. */
const FACE_OUTAGE: Record<string, string> = {
  rate_limited: "얼굴 사진 요청이 몰려서 지금은 사진을 만들 수 없어요.",
  timeout: "얼굴 사진을 만드는 데 시간이 너무 오래 걸렸어요.",
};
const FACE_OUTAGE_DEFAULT = "얼굴 사진을 만드는 이미지 서비스를 지금 쓸 수 없어요.";

const slotFrom = (j: StoredJudge): Slot => ({ key: j.id, temperament: j.temperament, judge: j, faceTemperament: j.temperament });

function SetupForm({ sid }: { sid: string }) {
  const router = useRouter();
  const situationId = useId();
  const hintId = useId();
  const [rec, setRec] = useState<SessionRecord | null>(null);
  const [failure, setFailure] = useState<{ message: string; notFound?: boolean } | null>(null);
  const [situation, setSituation] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [uploads, setUploads] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [starting, setStarting] = useState(false);
  const [, rerender] = useState(0);

  const slotsRef = useRef<Slot[]>([]);
  const calls = useRef(new Map<AbortController, string[]>());
  const situationTimer = useRef<number | null>(null);
  const situationRef = useRef("");
  const autoGenerated = useRef(false);

  /** Every form write goes through here; blobs the saved record no longer points at are deleted after it commits. */
  const save = (fn: (cur: SessionRecord) => SessionRecord) => {
    let dropped: string[] = [];
    return updateSession(sid, (cur) => {
      const next = fn(cur);
      const kept = new Set(blobKeysOf(next));
      dropped = blobKeysOf(cur).filter((k) => !kept.has(k));
      return next;
    }).then(
      (r) => {
        setSaveError("");
        void dropBlobs(dropped).catch(() => {});
        return r;
      },
      (e) => {
        setSaveError(errorText(e, "입력한 내용을 저장하지 못했어요."));
        throw e;
      },
    );
  };

  // ── load ──
  useEffect(() => {
    let live = true;
    resolveDraft(sid).then(
      (r) => {
        if (!live) return;
        if ("redirect" in r) return router.replace(`/setup?s=${r.redirect}`);
        if ("notFound" in r) return setFailure({ notFound: true, message: "삭제됐거나 다른 기기에서 만든 기록이에요. 새로 설정해 주세요." });
        const p = r.rec.setup;
        const setup = {
          situation: p.situation,
          presentationMinutes: Math.min(PRESENTATION_MIN.max, Math.max(PRESENTATION_MIN.min, p.presentationMinutes)),
          qaMinutes: Math.min(QA_MIN.max, Math.max(QA_MIN.min, p.qaMinutes)),
        };
        setRec({ ...r.rec, setup });
        setSituation(setup.situation);
        situationRef.current = setup.situation;
        slotsRef.current = r.rec.judges.map(slotFrom);
        setSlots(slotsRef.current);
      },
      (e) => live && setFailure({ message: errorText(e, "잠시 뒤 다시 시도해 주세요.") }),
    );
    return () => {
      live = false;
    };
  }, [sid, router]);

  // Abort judge generation on leave; save typed text that is still waiting for its debounce.
  useEffect(() => {
    const pending = calls.current;
    return () => {
      pending.forEach((_, ctl) => ctl.abort());
      if (situationTimer.current !== null) {
        window.clearTimeout(situationTimer.current);
        situationTimer.current = null;
        const text = situationRef.current;
        void updateSession(sid, (cur) => ({ ...cur, setup: { ...cur.setup, situation: text } })).catch(() => {});
      }
    };
  }, [sid]);

  // ── wiki builds: show progress, pick up results, resume builds this tab is not running ──
  const recId = rec?.id;
  useEffect(() => {
    if (!recId) return;
    const off = onWikiChange(() => {
      rerender((n) => n + 1);
      getSession(recId)
        .then((fresh) => fresh && setRec((cur) => cur && { ...cur, docs: fresh.docs }))
        .catch(() => {});
    });
    getSession(recId)
      .then((fresh) => {
        for (const d of [fresh?.docs.presentation, fresh?.docs.proposal]) if (d && (d.wikiState === "pending" || d.wikiState === "building")) void buildWiki(recId, d);
      })
      .catch(() => {});
    return off;
  }, [recId]);

  // ── judges ──
  const commit = (fn: (s: Slot[]) => Slot[]) => {
    const next = fn(slotsRef.current);
    slotsRef.current = next;
    setSlots(next);
    const judges = next.flatMap((s) => (s.judge ? [{ ...s.judge, temperament: s.temperament }] : []));
    void save((cur) => ({ ...cur, judges })).catch(() => {});
  };

  async function generate(keys: string[], temperaments: Temperament[]) {
    const others = slotsRef.current.flatMap((s) => (s.judge && !keys.includes(s.key) ? [s.judge] : []));
    const avoid: RollAvoid | undefined = others.length
      ? { names: others.map((j) => j.name), surnames: others.map((j) => j.fullName.slice(0, 1)), genders: others.map((j) => j.gender), ages: others.map((j) => j.age) }
      : undefined;
    commit((ss) => ss.map((s) => (keys.includes(s.key) ? { ...s, pending: true, error: undefined, errorCode: undefined } : s)));
    const ctl = new AbortController();
    calls.current.set(ctl, keys);
    const settled = new Set<string>();
    const stores: Promise<void>[] = [];
    // A row without a judge yet gets the named stand-in /present would use, so setup shows the same name and initial.
    const fail = (key: string, message: string, code?: string) =>
      commit((ss) => {
        const taken = ss.flatMap((s) => (s.judge ? [s.judge] : []));
        return ss.map((s) => (s.key === key ? { ...s, pending: false, error: message, errorCode: code, judge: s.judge ?? fallbackJudge(s.temperament, taken) } : s));
      });
    try {
      await streamJudges(
        { temperaments, avoid },
        {
          signal: ctl.signal,
          onEvent: (e) => {
            if (e.type === "done") return;
            const key = keys[e.slot];
            if (!key) return;
            settled.add(key);
            if (e.type === "error") return fail(key, e.message, e.code);
            const j = e.judge;
            stores.push(
              storeJudgeImage(j.id, j.image).then(
                (blobKeys) => {
                  // The row was removed while its face was being made: nothing will point at these.
                  if (!slotsRef.current.some((s) => s.key === key)) return void dropBlobs([blobKeys.imageKey, blobKeys.thumbKey]).catch(() => {});
                  commit((ss) =>
                    ss.map((s) =>
                      s.key === key
                        ? {
                            ...s,
                            pending: false,
                            error: undefined,
                            errorCode: undefined,
                            faceTemperament: j.temperament,
                            judge: { id: j.id, name: j.name, fullName: j.fullName, gender: j.gender, age: j.age, voiceHint: j.voiceHint, temperament: s.temperament, ...blobKeys },
                          }
                        : s,
                    ),
                  );
                },
                (err) => fail(key, errorText(err, "얼굴 사진을 저장하지 못했어요."), "store"),
              ),
            );
          },
        },
      );
      await Promise.all(stores);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      const message = e instanceof ApiError ? e.message : "심사위원을 만들지 못했어요. 다시 시도해 주세요.";
      const code = e instanceof ApiError ? e.code : "network";
      for (const k of keys) if (!settled.has(k)) fail(k, message, code);
    } finally {
      calls.current.delete(ctl);
    }
  }

  // A new draft starts with one judge per persona.
  useEffect(() => {
    if (!recId || autoGenerated.current) return;
    autoGenerated.current = true;
    if (slotsRef.current.length) return;
    const first = PERSONAS.map((p) => ({ key: crypto.randomUUID(), temperament: p.value }));
    commit(() => first);
    void generate(
      first.map((s) => s.key),
      first.map((s) => s.temperament),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per loaded draft
  }, [recId]);

  const addJudge = () => {
    if (slotsRef.current.length >= MAX_JUDGES) return;
    const used = new Set(slotsRef.current.map((s) => s.temperament));
    const temperament = PERSONAS.find((p) => !used.has(p.value))?.value ?? "friendly";
    const key = crypto.randomUUID();
    commit((ss) => [...ss, { key, temperament }]);
    void generate([key], [temperament]);
  };
  const removeJudge = (key: string) => {
    if (slotsRef.current.length <= 1) return;
    commit((ss) => ss.filter((s) => s.key !== key));
    const left = new Set(slotsRef.current.map((s) => s.key));
    calls.current.forEach((ks, ctl) => ks.every((k) => !left.has(k)) && ctl.abort());
  };
  const setPersona = (key: string, temperament: Temperament) => commit((ss) => ss.map((s) => (s.key === key ? { ...s, temperament } : s)));

  // ── documents ──
  async function attach(role: DocRole, file: File) {
    setUploads((n) => n + 1);
    try {
      const info = await readPdf(file);
      const chars = info.pageTexts.reduce((a, t) => a + t.length, 0);
      const withText = info.pageCount - info.emptyPages.length;
      if (withText < info.pageCount * 0.3 || chars < 50) throw new Error("글자가 거의 없는 PDF예요. 스캔본은 아직 쓸 수 없어요. 글자를 선택할 수 있는 PDF를 올려 주세요.");
      // Same caps as the wiki route (413 / 422), checked before anything is stored.
      if (chars > MAX_DOC_CHARS) throw new Error(`글자 수가 너무 많아요(${chars.toLocaleString()}자). 15만 자 이하 자료만 쓸 수 있어요.`);
      const pending = blobKey.pdf(info.docId);
      attaching.add(pending);
      let next: SessionRecord;
      let doc: StoredDoc;
      try {
        const pdfKey = await storePdf(info.docId, file);
        doc = {
          role,
          docId: info.docId,
          filename: file.name.slice(0, 200),
          bytes: info.bytes,
          pageCount: info.pageCount,
          pdfKey,
          pageTexts: info.pageTexts,
          emptyPages: info.emptyPages,
          wikiState: "pending",
        };
        next = await save((cur) => ({ ...cur, docs: { ...cur.docs, [role]: doc } }));
      } catch (e) {
        attaching.delete(pending);
        void dropBlobs([pending]).catch(() => {}); // stored but never saved (kept if another session uses the same file)
        throw e;
      }
      attaching.delete(pending);
      setRec((cur) => cur && { ...cur, docs: next.docs });
      void buildWiki(sid, doc);
    } finally {
      setUploads((n) => n - 1);
    }
  }
  async function attachSample(role: DocRole) {
    const res = await fetch(SAMPLE[role].url).catch(() => null);
    if (!res?.ok) throw new Error("샘플 자료를 불러오지 못했어요. 다시 시도해 주세요.");
    await attach(role, new File([await res.blob()], SAMPLE[role].name, { type: "application/pdf" }));
    if (role === "presentation" && !situationRef.current.trim()) changeSituation(SAMPLE_SITUATION);
  }
  const detach = (role: DocRole) =>
    void save((cur) => {
      const docs = { ...cur.docs };
      delete docs[role];
      return { ...cur, docs };
    }).then((next) => setRec((cur) => cur && { ...cur, docs: next.docs }), () => {});

  // ── setup fields ──
  function changeSituation(text: string) {
    setSituation(text);
    situationRef.current = text;
    if (situationTimer.current !== null) window.clearTimeout(situationTimer.current);
    situationTimer.current = window.setTimeout(() => {
      situationTimer.current = null;
      void save((cur) => ({ ...cur, setup: { ...cur.setup, situation: situationRef.current } })).catch(() => {});
    }, 400);
  }
  const setMinutes = (field: "presentationMinutes" | "qaMinutes", v: number) => {
    setRec((cur) => cur && { ...cur, setup: { ...cur.setup, [field]: v } });
    void save((cur) => ({ ...cur, setup: { ...cur.setup, [field]: v } })).catch(() => {});
  };

  if (failure)
    return (
      <Shell>
        <LoadFailure {...failure} />
      </Shell>
    );
  if (!rec)
    return (
      <Shell>
        <Loading />
      </Shell>
    );

  const { presentationMinutes, qaMinutes } = rec.setup;
  const generating = slots.some((s) => s.pending);
  const faceless = slots.some((s) => !s.pending && !s.judge?.imageKey);
  // Two or more faces failed for the same reason → one notice instead of the same message on every row.
  const failed = slots.filter((s) => s.error);
  const outage = failed.length >= 2 && failed.every((s) => s.errorCode === failed[0].errorCode) ? (FACE_OUTAGE[failed[0].errorCode ?? ""] ?? FACE_OUTAGE_DEFAULT) : null;
  const retryFailed = () =>
    void generate(
      failed.map((s) => s.key),
      failed.map((s) => s.temperament),
    );
  const missing = [
    !situation.trim() && "발표 상황을 입력해 주세요.",
    uploads > 0 && "자료를 읽고 있어요. 잠시만 기다려 주세요.",
    !rec.docs.presentation && "발표 자료를 올려 주세요.",
    generating && "심사위원 얼굴을 만들고 있어요. 잠시만 기다려 주세요.",
  ].filter((m): m is string => !!m);
  const ready = missing.length === 0 && slots.length > 0 && !starting;

  async function start() {
    if (!ready) return;
    platform.audio.unlock(); // inside the tap, so judge voices can autoplay later (iOS)
    setStarting(true);
    if (situationTimer.current !== null) window.clearTimeout(situationTimer.current);
    situationTimer.current = null;
    const known = slotsRef.current.flatMap((s) => (s.judge ? [s.judge] : []));
    const judges: StoredJudge[] = [];
    for (const s of slotsRef.current) judges.push(s.judge ? { ...s.judge, temperament: s.temperament } : fallbackJudge(s.temperament, [...known, ...judges]));
    try {
      await save((cur) => ({ ...cur, status: "presentation", resume: undefined, judges, setup: { ...cur.setup, situation: situationRef.current.trim() } }));
      router.push(`/present?s=${sid}`);
    } catch {
      setStarting(false);
    }
  }

  return (
    <>
      <Screen bottomPad={faceless ? 176 : 150}>
        <BrandHeader backHref="/" />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[20px] font-bold leading-7 tracking-[-0.4px]">상황 설정</p>
          <HeaderPill label="3단계 중 1단계">
            01 <span className="ml-1 font-medium text-secondary">/ 03</span>
          </HeaderPill>
        </div>

        <main className="mt-5 flex flex-col">
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
              rows={2}
              value={situation}
              onChange={(e) => changeSituation(e.target.value)}
              placeholder={"예) 친환경 패키징 사업 제안\n투자 심사위원을 설득하는 발표"}
              className="w-full resize-none rounded-[16px] bg-surface px-5 py-4 text-[16px] leading-6 placeholder:text-secondary/70 focus:outline-2 focus:outline-ink"
              maxLength={SITUATION_MAX}
            />
            <p className="text-right text-[12px] text-secondary tabular">
              {situation.length} / {SITUATION_MAX}
            </p>
          </div>

          <div className="mt-2 flex flex-col gap-6">
            <MinuteSlider label="발표 시간" {...PRESENTATION_MIN} value={presentationMinutes} onChange={(v) => setMinutes("presentationMinutes", v)} />
            <MinuteSlider label="질의응답 시간" {...QA_MIN} value={qaMinutes} onChange={(v) => setMinutes("qaMinutes", v)} />
          </div>

          <div className="mt-8 flex flex-col gap-6">
            {(["presentation", "proposal"] as const).map((role) => {
              const doc = rec.docs[role];
              return (
                <div key={role} className="flex flex-col gap-2">
                  <UploadRow
                    label={role === "presentation" ? "발표 자료" : "제안 자료"}
                    required={role === "presentation"}
                    value={doc && { name: doc.filename, pages: doc.pageCount, size: doc.bytes }}
                    onFile={(f) => attach(role, f)}
                    onRemove={() => detach(role)}
                    onSample={() => attachSample(role)}
                    sampleLabel="샘플 자료로 해보기"
                    maxBytes={PDF_LIMITS.maxBytes}
                  />
                  {doc && <WikiStatus sid={sid} doc={doc} />}
                </div>
              );
            })}
          </div>

          <section className="mt-9 flex flex-col gap-3" aria-labelledby="judges-h">
            <div className="flex items-center justify-between">
              <h2 id="judges-h" className="text-[20px] font-bold leading-7 tracking-[-0.4px]">
                심사위원 <span className="text-secondary tabular">{slots.length}</span>
              </h2>
              <button
                type="button"
                onClick={addJudge}
                disabled={slots.length >= MAX_JUDGES}
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-surface px-4 text-[15px] font-semibold hover:bg-card disabled:text-secondary"
              >
                <Plus size={18} /> 추가
              </button>
            </div>
            {outage && (
              <div className="flex items-center gap-2 rounded-[16px] border border-line py-1.5 pl-4 pr-1.5" role="alert" data-testid="face-outage">
                <Alert size={18} className="shrink-0 text-secondary" />
                <p className="min-w-0 flex-1 break-keep text-[13px] leading-[18px]">
                  {outage} 심사위원 {failed.length}명은 이름 첫 글자로 표시되고, 발표는 그대로 시작할 수 있어요.
                </p>
                <button type="button" onClick={retryFailed} disabled={generating} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[14px] font-semibold disabled:text-secondary">
                  <Refresh size={16} /> 다시 시도
                </button>
              </div>
            )}
            <ul className="flex flex-col gap-2.5" aria-label="심사위원 목록">
              {slots.map((s) => (
                <JudgeSlotRow
                  key={s.key}
                  slot={s}
                  hideError={!!outage}
                  onRemove={slots.length > 1 ? () => removeJudge(s.key) : undefined}
                  onPersona={(t) => setPersona(s.key, t)}
                  onGenerate={() => void generate([s.key], [s.temperament])}
                />
              ))}
            </ul>
            <p className="break-keep text-pretty text-[12px] leading-[18px] text-secondary">성향에 따라 질문하는 말투와 강도가 달라져요. 심사위원은 최대 {MAX_JUDGES}명까지 추가할 수 있어요.</p>
          </section>

          {saveError && (
            <p className="mt-6 flex items-start gap-2 rounded-[16px] border border-error/40 px-4 py-3 text-[14px] leading-5" role="alert">
              <Alert size={18} className="mt-0.5 shrink-0 text-error" />
              {saveError}
            </p>
          )}
        </main>
      </Screen>

      <BottomBar>
        <p className="text-center text-[14px] font-medium text-secondary tabular" aria-live="polite">
          총 {presentationMinutes + qaMinutes}분 · 심사위원 {slots.length}명
        </p>
        {faceless && !generating && !outage && <p className="text-center text-[13px] leading-[18px] text-secondary">얼굴 사진이 없는 심사위원은 이름 첫 글자로 표시돼요.</p>}
        <Button onClick={start} disabled={!ready} arrow aria-describedby={missing.length ? hintId : undefined}>
          {starting ? "준비하는 중…" : "발표 시작하기"}
        </Button>
        {missing.length > 0 && (
          <p id={hintId} className="text-center text-[13px] leading-[18px] text-secondary">
            {missing[0]}
          </p>
        )}
      </BottomBar>
    </>
  );
}

/**
 * Persona chips sized to share the judge row (draft 02): 32px pills; an invisible ::before
 * stretches each chip's hit area to ≥44px without growing the row.
 */
const ROW_CHIPS =
  "flex-nowrap! gap-1! [&>button]:relative [&>button]:h-8 [&>button]:px-2.5 [&>button]:text-[13px] [&>button]:before:absolute [&>button]:before:-inset-x-0.5 [&>button]:before:-inset-y-1.5 [&>button]:before:content-['']";

/** One compact row like draft 02: face | name + age | persona chips | ✕. Retry / regenerate drop below only when needed. */
function JudgeSlotRow({
  slot,
  hideError,
  onRemove,
  onPersona,
  onGenerate,
}: {
  slot: Slot;
  /** The section shows one shared notice for this failure instead. */
  hideError?: boolean;
  onRemove?: () => void;
  onPersona: (t: Temperament) => void;
  onGenerate: () => void;
}) {
  const imageUrl = useBlobUrl(slot.judge?.thumbKey || undefined);
  const j = slot.judge;
  const name = j?.name ?? "새 위원";
  const caption = slot.pending ? "만드는 중…" : j ? `${Math.floor(j.age / 10) * 10}대` : "얼굴 사진 없음";
  const stale = !slot.pending && !slot.error && j && (!j.imageKey || slot.faceTemperament !== slot.temperament);
  return (
    <li className="ui-enter rounded-[20px] bg-surface py-2.5 pl-3 pr-1">
      <div className="flex items-center gap-2">
        <JudgeAvatar judge={{ name, persona: TEMPERAMENT_LABEL[slot.temperament], imageUrl, pending: slot.pending }} size={44} />
        <div className="min-w-0 flex-1 border-l border-line pl-2">
          <p className="truncate text-[16px] font-bold leading-[22px]">{name}</p>
          <p className="truncate text-[12px] leading-4 text-secondary" aria-live="polite">
            {caption}
          </p>
        </div>
        <ChipGroup label={`${name} 심사위원 성향`} options={PERSONAS} value={slot.temperament} onChange={onPersona} size="sm" onSurface className={ROW_CHIPS} />
        {onRemove ? (
          <button type="button" onClick={onRemove} aria-label={`${name} 심사위원 삭제`} className="relative inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-x-1 before:inset-y-0 before:content-[''] hover:bg-card">
            <Close size={18} />
          </button>
        ) : (
          <span className="w-2 shrink-0" aria-hidden="true" />
        )}
      </div>
      {slot.error && !hideError && (
        <div className="mt-2 flex items-center gap-2 pl-[52px] pr-2" role="alert">
          <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-error">{slot.error}</p>
          <button type="button" onClick={onGenerate} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-canvas px-3.5 text-[14px] font-semibold">
            <Refresh size={16} /> 다시 시도
          </button>
        </div>
      )}
      {stale && (
        <div className="pl-[52px]">
          <button type="button" onClick={onGenerate} className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-secondary underline underline-offset-4 hover:text-ink">
            {j.imageKey ? "이 성향으로 새 심사위원 만들기" : "얼굴 만들기"}
          </button>
        </div>
      )}
    </li>
  );
}

function WikiStatus({ sid, doc }: { sid: string; doc: StoredDoc }) {
  const progress = wikiProgress(sid, doc);
  const empty = doc.emptyPages.length;
  const emptyNote =
    empty > 0 && `글자가 없는 ${doc.emptyPages.slice(0, 5).join(", ")}쪽${empty > 5 ? ` 외 ${empty - 5}쪽` : ""}은 분석에서 빠져요.`;
  if (doc.wikiState === "error")
    return (
      <div className="flex items-center gap-2 rounded-[16px] border border-error/40 py-1.5 pl-4 pr-1.5" role="alert">
        <Alert size={18} className="shrink-0 text-error" />
        <p className="min-w-0 flex-1 text-[13px] leading-[18px]">
          <span className="font-semibold text-error">자료 분석 실패</span>
          <span className="text-secondary"> · {doc.wikiError ?? "다시 시도해 주세요."}</span>
        </p>
        <button type="button" onClick={() => void buildWiki(sid, doc)} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[14px] font-semibold">
          <Refresh size={16} /> 다시 시도
        </button>
      </div>
    );
  if (doc.wikiState === "ready")
    return (
      <div className="flex flex-col gap-1.5 px-1">
        <p className="text-[13px] leading-[18px] text-secondary">
          자료 분석을 마쳤어요. 심사위원이 이 자료를 근거로 질문해요.{emptyNote && ` ${emptyNote}`}
        </p>
        {doc.wikiDegraded && (
          <p className="flex items-start gap-1.5 break-keep text-[13px] leading-[18px]" role="note" data-testid="wiki-degraded">
            <Alert size={16} className="mt-px shrink-0 text-secondary" />
            <span>
              주력 AI 모델을 쓸 수 없어서 경량 대체 모델{doc.wikiModel ? `(Google ${doc.wikiModel})` : ""}로 자료를 분석했어요. 질문과 리포트가 평소보다 덜 정확할 수 있어요.
            </span>
          </p>
        )}
      </div>
    );
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5 px-1" role="status">
      <div className="flex items-center justify-between gap-3 text-[13px] leading-[18px] text-secondary">
        <span>질문에 쓸 자료를 분석하고 있어요. 기다리지 않고 발표를 시작해도 돼요.</span>
        <span className="shrink-0 tabular">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      {emptyNote && <p className="text-[12px] leading-[18px] text-secondary">{emptyNote}</p>}
    </div>
  );
}
