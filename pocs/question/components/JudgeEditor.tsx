"use client";
import { useState } from "react";
import type { Temperament } from "@/lib/types";
import { TEMPERAMENT_LABEL } from "@/lib/types";
import { TEMPERAMENT_DESC, type QJudge } from "../lib/types";
import { Button, Chip, Face } from "./ui";

const TEMPS: Temperament[] = ["friendly", "strict", "aggressive"];

/** Pick a generated face for each judge: same temperament (+ gender if possible), unused, closest age. */
export function autoMatchFaces(judges: QJudge[], faces: QJudge[]): QJudge[] {
  const used = new Set<string>();
  return judges.map((j) => {
    const cands = faces.filter((f) => f.temperament === j.temperament && !used.has(f.id));
    const sameG = cands.filter((f) => f.gender === j.gender);
    const pool = sameG.length ? sameG : cands;
    const best = [...pool].sort((a, b) => Math.abs(a.age - j.age) - Math.abs(b.age - j.age))[0];
    if (!best) return j;
    used.add(best.id);
    return { ...best };
  });
}

export function JudgeEditor({ judges, faces, onChange }: { judges: QJudge[]; faces: QJudge[]; onChange: (j: QJudge[]) => void }) {
  const [picker, setPicker] = useState<number | null>(null);
  const update = (i: number, patch: Partial<QJudge>) => onChange(judges.map((j, k) => (k === i ? { ...j, ...patch } : j)));
  // ids must stay unique (questions, assignments and React keys are keyed by judge id)
  const uniqueId = (id: string, i: number) => {
    const taken = (x: string) => judges.some((j, k) => k !== i && j.id === x);
    let out = id;
    for (let n = 2; taken(out); n++) out = `${id}-${n}`;
    return out;
  };
  const usedFace = (f: QJudge, i: number) => judges.some((j, k) => k !== i && (j.id === f.id || (!!f.imageUrl && j.imageUrl === f.imageUrl)));
  const add = () => {
    const used = new Set(judges.map((j) => j.temperament));
    const t = TEMPS.find((x) => !used.has(x)) ?? "strict";
    onChange([...judges, { id: `judge-${Date.now().toString(36)}`, name: ["민수", "지연", "도윤"][judges.length % 3], temperament: t, gender: judges.length % 2 ? "female" : "male", age: 45 }]);
  };
  return (
    <div className="space-y-3">
      {judges.map((j, i) => (
        <div key={j.id} className="rounded-[20px] bg-canvas p-4" data-testid="judge-card">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setPicker(picker === i ? null : i)} aria-label={`${j.name} 얼굴 선택`} className="rounded-full">
              <Face name={j.name} imageUrl={j.imageUrl} className="h-14 w-14" />
            </button>
            <label className="sr-only" htmlFor={`jn-${j.id}`}>이름</label>
            <input id={`jn-${j.id}`} value={j.name} maxLength={10} onChange={(e) => update(i, { name: e.target.value })} className="h-11 min-w-0 flex-1 rounded-[14px] bg-surface px-3 text-[15px] font-semibold" />
            {judges.length > 1 ? (
              <button type="button" onClick={() => onChange(judges.filter((_, k) => k !== i))} aria-label={`${j.name} 삭제`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-lg">
                ×
              </button>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label="성별">
              {(["male", "female"] as const).map((g) => (
                <Chip key={g} selected={j.gender === g} onClick={() => update(i, { gender: g, imageUrl: undefined })} className="px-3.5">
                  {g === "male" ? "남" : "여"}
                </Chip>
              ))}
            </div>
            <label className="flex items-center gap-1 text-sm text-secondary">
              <input type="number" min={20} max={80} value={j.age} onChange={(e) => update(i, { age: Math.max(20, Math.min(80, Number(e.target.value) || 45)) })} className="tabular h-11 w-16 rounded-[14px] bg-surface px-2 text-center text-[15px] text-ink" aria-label="나이" />세
            </label>
            <span className="text-xs text-secondary">얼굴을 누르면 생성된 얼굴 선택</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="성향">
            {TEMPS.map((t) => (
              <Chip key={t} selected={j.temperament === t} role="radio" aria-checked={j.temperament === t} onClick={() => update(i, { temperament: t, imageUrl: j.temperament === t ? j.imageUrl : undefined })} className="px-2">
                {TEMPERAMENT_LABEL[t]}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-secondary">{TEMPERAMENT_DESC[j.temperament]}</p>
          {picker === i ? (
            <div className="mt-3">
              <p className="mb-2 text-xs text-secondary">생성된 심사위원 얼굴 ({TEMPERAMENT_LABEL[j.temperament]}) — 고르면 이름·성별·나이도 함께 바뀝니다</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {faces.filter((f) => f.temperament === j.temperament).map((f) => {
                  const taken = usedFace(f, i);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={taken}
                      onClick={() => {
                        update(i, { ...f, id: uniqueId(f.id, i) });
                        setPicker(null);
                      }}
                      className="shrink-0 text-center disabled:opacity-40"
                      aria-label={taken ? `${f.name} (다른 심사위원이 사용 중)` : `${f.name} ${f.age}세 선택`}
                    >
                      <Face name={f.name} imageUrl={f.imageUrl} className="h-14 w-14" />
                      <span className="mt-1 block text-[11px] text-secondary">{taken ? "사용 중" : `${f.name}·${f.age}`}</span>
                    </button>
                  );
                })}
                {!faces.some((f) => f.temperament === j.temperament) ? <span className="text-xs text-secondary">생성된 얼굴이 없습니다 (/judge 에서 생성)</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {judges.length < 3 ? (
          <Button variant="secondary" size="sm" onClick={add}>
            + 심사위원 추가
          </Button>
        ) : null}
        {faces.length ? (
          <Button variant="secondary" size="sm" onClick={() => onChange(autoMatchFaces(judges, faces))}>
            생성된 얼굴 자동 연결
          </Button>
        ) : null}
      </div>
    </div>
  );
}
