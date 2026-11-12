"use client";
import { useMemo, useRef, useState } from "react";
import { TEMPERAMENT_LABEL, type Gender, type Temperament } from "@/lib/types";
import { fetchTts, playWav, stopAll } from "../client/playWav";
import { resolveVoice, SAMPLE_QUESTIONS, VOICE_TABLE } from "../lib/persona";

const TEMPS: Temperament[] = ["friendly", "strict", "aggressive"];
const GENDERS: { key: Gender; label: string }[] = [
  { key: "male", label: "남자" },
  { key: "female", label: "여자" },
];

interface Clip {
  id: string;
  label: string;
  text: string;
  blob: Blob;
  voice: string;
  style: string;
  model: string;
  cached: boolean;
  durationSec: number;
  totalMs: number;
}

function Chip({ selected, onClick, children, disabled }: { selected: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors ${selected ? "bg-ink text-inverse" : "bg-canvas text-ink"}`}
    >
      {children}
    </button>
  );
}

export function TtsPanel() {
  const [gender, setGender] = useState<Gender>("male");
  const [age, setAge] = useState(58);
  const [temperament, setTemperament] = useState<Temperament>("strict");
  const [text, setText] = useState(SAMPLE_QUESTIONS.strict);
  const [busy, setBusy] = useState<null | "one" | "compare">(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const idRef = useRef(0);
  const seqRef = useRef(0);

  const resolved = useMemo(() => resolveVoice({ gender, age, temperament }), [gender, age, temperament]);
  const personaLabel = (t: Temperament) => `${gender === "male" ? "남자" : "여자"} · ${age}세 · ${TEMPERAMENT_LABEL[t]}`;

  const pickTemperament = (t: Temperament) => {
    // replace the sample line only if the user has not edited it
    if (Object.values(SAMPLE_QUESTIONS).includes(text)) setText(SAMPLE_QUESTIONS[t]);
    setTemperament(t);
  };

  const play = async (c: Clip) => {
    if (playing === c.id) { stopAll(); setPlaying(null); return; }
    setPlaying(c.id);
    try {
      await playWav(c.blob).done;
    } catch (e) {
      setError(`재생 실패: ${(e as Error).message}`);
    } finally {
      setPlaying((p) => (p === c.id ? null : p));
    }
  };

  const synth = async (t: Temperament): Promise<Clip> => {
    const r = await fetchTts({ text, gender, age, temperament: t });
    return { id: `c${++idRef.current}`, label: personaLabel(t), text, ...r };
  };

  const errText = (e: unknown) => {
    const err = e as Error & { retryAfterSec?: number };
    return err.retryAfterSec ? `${err.message} (약 ${err.retryAfterSec}초 후)` : err.message;
  };

  const generate = async () => {
    seqRef.current++; // cancel a running compare playback
    setBusy("one");
    setError(null);
    setProgress("음성 생성 중…");
    try {
      const c = await synth(temperament);
      setClips((prev) => [c, ...prev].slice(0, 12));
      setBusy(null);
      setProgress("");
      void play(c);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  /** Same sentence in all three temperaments, then played back in order. */
  const compare = async () => {
    const seq = ++seqRef.current;
    setBusy("compare");
    setError(null);
    const made: Clip[] = [];
    try {
      for (const t of TEMPS) {
        setProgress(`${TEMPERAMENT_LABEL[t]} 생성 중… (${made.length + 1}/3)`);
        made.push(await synth(t));
      }
    } catch (e) {
      setError(errText(e));
    }
    if (made.length) setClips((prev) => [...made, ...prev].slice(0, 12));
    setBusy(null);
    for (const [i, c] of made.entries()) {
      if (seqRef.current !== seq) break;
      setProgress(`${c.label} 재생 중 (${i + 1}/${made.length})`);
      await play(c);
    }
    if (seqRef.current === seq) setProgress("");
  };

  return (
    <section className="rounded-[28px] bg-surface p-5 sm:p-6 flex flex-col gap-5" aria-labelledby="tts-title">
      <div>
        <p className="text-sm font-medium text-secondary">TTS · Gemini</p>
        <h2 id="tts-title" className="text-xl leading-7 font-semibold tracking-[-0.4px]">심사위원 페르소나 음성</h2>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-2">성별</legend>
        <div role="radiogroup" aria-label="성별" className="flex gap-2">
          {GENDERS.map((g) => (
            <Chip key={g.key} selected={gender === g.key} onClick={() => setGender(g.key)}>{g.label}</Chip>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="tts-age" className="text-sm font-medium">연령</label>
          <span className="text-sm font-semibold tabular" data-testid="tts-age">{age}세</span>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" aria-label="연령 낮추기" onClick={() => setAge((a) => Math.max(20, a - 1))} className="w-11 h-11 rounded-full bg-canvas text-lg font-semibold">−</button>
          <input id="tts-age" type="range" min={20} max={70} step={1} value={age} onChange={(e) => setAge(Number(e.target.value))} className="flex-1 accent-[#111111]" />
          <button type="button" aria-label="연령 높이기" onClick={() => setAge((a) => Math.min(70, a + 1))} className="w-11 h-11 rounded-full bg-canvas text-lg font-semibold">+</button>
        </div>
        <p className="text-xs leading-[18px] text-secondary" data-testid="tts-age-bands">
          음성: 20–39세 <b className={age < 40 ? "text-ink" : "font-normal"}>{VOICE_TABLE[gender][temperament].young.voice}</b> · 40–70세{" "}
          <b className={age >= 40 ? "text-ink" : "font-normal"}>{VOICE_TABLE[gender][temperament].senior.voice}</b>. 같은 음성 안에서는 나이(1세 단위)에 따라 음높이·말 속도 지시가 바뀝니다.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-2">성향</legend>
        <div role="radiogroup" aria-label="성향" className="flex gap-2 flex-wrap">
          {TEMPS.map((t) => (
            <Chip key={t} selected={temperament === t} onClick={() => pickTemperament(t)}>{TEMPERAMENT_LABEL[t]}</Chip>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="tts-text" className="text-sm font-medium">읽을 문장</label>
        <textarea
          id="tts-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={1200}
          className="min-h-[52px] rounded-[16px] bg-canvas px-4 py-3 text-base leading-6 resize-y outline-none focus-visible:ring-2 focus-visible:ring-ink"
        />
      </div>

      <div className="rounded-[20px] bg-canvas px-4 py-3 flex flex-col gap-1" data-testid="tts-resolved">
        <p className="text-sm">
          <span className="text-secondary">음성</span> <b data-testid="tts-voice">{resolved.voice}</b>
          <span className="text-secondary"> · {resolved.character}</span>
        </p>
        <p className="text-xs leading-[18px] text-secondary break-words">
          <span className="font-medium text-ink">스타일 프롬프트</span> {resolved.style}
        </p>
      </div>

      <p className="text-xs leading-[18px] text-secondary">
        무료 티어 한도: TTS 모델별 하루 10회·분당 3회 (4개 모델 자동 폴백). 같은 문장·페르소나는 캐시에서 즉시 재생됩니다.
      </p>

      {error && <p role="alert" className="text-sm text-error font-medium" data-testid="tts-error">{error}</p>}
      {progress && <p className="text-sm text-secondary" aria-live="polite" data-testid="tts-progress">{progress}</p>}

      <div className="flex flex-col sm:flex-row gap-2">
        <button data-testid="tts-generate" onClick={() => void generate()} disabled={!!busy || !text.trim()} className="h-14 sm:flex-1 rounded-[20px] bg-ink text-inverse font-semibold disabled:opacity-60">
          {busy === "one" ? "생성 중…" : "음성 생성"}
        </button>
        <button data-testid="tts-compare" onClick={() => void compare()} disabled={!!busy || !text.trim()} className="h-14 sm:flex-1 rounded-[20px] bg-canvas font-semibold disabled:text-secondary">
          {busy === "compare" ? "비교 중…" : "3가지 성향 비교"}
        </button>
      </div>

      {clips.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="생성된 음성">
          {clips.map((c) => (
            <li key={c.id} data-testid="tts-clip" className="rounded-[20px] bg-canvas px-3 py-3 flex items-center gap-3">
              <button
                onClick={() => { seqRef.current++; setProgress(""); void play(c); }}
                aria-label={playing === c.id ? "정지" : "재생"}
                className="shrink-0 w-11 h-11 rounded-full bg-ink text-inverse grid place-items-center"
              >
                {playing === c.id ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 1.8v10.4a.8.8 0 0 0 1.2.7l8.6-5.2a.8.8 0 0 0 0-1.4L4.2 1.1A.8.8 0 0 0 3 1.8Z" fill="currentColor" /></svg>
                )}
              </button>
              <div className="min-w-0 flex flex-col">
                <span className="text-sm font-semibold">{c.label}</span>
                <span className="text-xs leading-[18px] text-secondary tabular truncate">
                  {c.voice} · {c.durationSec.toFixed(1)}초 · {c.cached ? "캐시" : `생성 ${(c.totalMs / 1000).toFixed(1)}초`} · {c.model}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
