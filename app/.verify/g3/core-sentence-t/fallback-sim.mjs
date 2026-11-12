// Pure check of the per-sentence start-mark rule in handleLiveMessage (final branch), old vs new.
// Scenario from G2 repro: utterance started 17.2 (VAD), interim marks seen[0]=18.1? no: seen[0]=utterStart,
// seen[1]=18.4; sentence 3 never appeared in an interim → no mark.
const utterStart = { t: 17.2 };
const seen = [utterStart, { t: 18.4 }]; // index 2 missing
const out = ["네.", "지금 원가가 ... 맞습니다.", "다만 저희 원료는 ..."];
const oldT = out.map((_, i) => (seen[i] ?? utterStart).t);
let prev = utterStart;
const at = (i) => { const m = seen[i]; return (prev = m && m.t >= prev.t ? m : prev); };
const newT = out.map((_, i) => at(i).t);
const carry = at(out.length).t; // carried sentence start (no mark either)
console.log({ oldT, newT, carryStart: carry, newAscending: newT.every((t, i) => !i || t >= newT[i - 1]) });
