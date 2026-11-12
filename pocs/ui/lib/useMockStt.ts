import { useEffect, useState } from "react";

export interface MockSttState {
  finals: string[]; // finalized sentences (문장별 전사)
  partial: string; // sentence currently being recognized
  status: "listening" | "final" | "idle";
}

/**
 * Simulates sentence-by-sentence STT: each sentence is "typed" in (음성 인식 중),
 * then held as 인식 완료, then the next one starts. Pauses while `running` is false.
 * Replace with the stt-tts PoC stream in the real app (same shape: partial + finals).
 */
export function useMockStt(sentences: string[], running: boolean, { charMs = 55, holdMs = 1300, gapMs = 500, loop = false } = {}): MockSttState {
  const [st, setSt] = useState({ idx: 0, chars: 0, phase: "typing" as "typing" | "hold" | "gap" | "end" });

  useEffect(() => {
    if (!running || st.phase === "end") return;
    const sentence = sentences[st.idx] ?? "";
    let delay = charMs;
    let next: typeof st;
    if (st.phase === "typing") {
      if (st.chars < sentence.length) next = { ...st, chars: st.chars + 1 };
      else next = { ...st, phase: "hold" };
    } else if (st.phase === "hold") {
      delay = holdMs;
      next = { ...st, phase: "gap" };
    } else {
      delay = gapMs;
      const idx = st.idx + 1;
      next = idx >= sentences.length ? (loop ? { idx: 0, chars: 0, phase: "typing" } : { ...st, phase: "end" }) : { idx, chars: 0, phase: "typing" };
    }
    const id = window.setTimeout(() => setSt(next), delay);
    return () => window.clearTimeout(id);
  }, [st, running, sentences, charMs, holdMs, gapMs, loop]);

  const finalsCount = st.phase === "typing" ? st.idx : st.idx + 1;
  const finals = sentences.slice(0, finalsCount);
  if (st.phase === "typing") return { finals, partial: (sentences[st.idx] ?? "").slice(0, st.chars), status: running ? "listening" : "idle" };
  return { finals, partial: "", status: st.phase === "end" ? "idle" : "final" };
}
