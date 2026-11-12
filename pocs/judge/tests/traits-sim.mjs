// Distribution check for rollTraits (no API calls). node --experimental-strip-types judge/tests/traits-sim.mjs
import { rollTraits, buildPrompt } from "../lib/traits.ts";
const N = 3000, c = { male: 0, female: 0 }, decades = {}, glasses = { yes: 0, no: 0 }, style = {};
for (let i = 0; i < N; i++) {
  const t = rollTraits(["friendly", "strict", "aggressive"][i % 3]);
  c[t.gender]++; decades[Math.floor(t.age / 10) * 10] = (decades[Math.floor(t.age / 10) * 10] ?? 0) + 1;
  glasses[t.glasses ? "yes" : "no"]++; style[t.attireStyle] = (style[t.attireStyle] ?? 0) + 1;
}
console.log({ N, gender: c, decades, glasses, style });
// panel balance
let mixed = 0, dupSur = 0, dupName = 0;
for (let i = 0; i < 1000; i++) {
  const avoid = { names: [], surnames: [], genders: [], ages: [] };
  for (const t of ["friendly", "strict", "aggressive"]) { const r = rollTraits(t, avoid); avoid.names.push(r.givenName); avoid.surnames.push(r.surname); avoid.genders.push(r.gender); avoid.ages.push(r.age); }
  if (new Set(avoid.genders).size === 2) mixed++;
  if (new Set(avoid.surnames).size < 3) dupSur++;
  if (new Set(avoid.names).size < 3) dupName++;
}
console.log("panels with mixed genders:", mixed / 10 + "%", "| repeated surname:", dupSur / 10 + "%", "| repeated given name:", dupName / 10 + "%");
// baseline without surname avoidance (pre-fix behaviour)
let base = 0;
for (let i = 0; i < 1000; i++) { const s = ["friendly", "strict", "aggressive"].map((t) => rollTraits(t).surname); if (new Set(s).size < 3) base++; }
console.log("baseline (no avoidance) repeated surname:", base / 10 + "%");
console.log("\n--- sample prompt ---\n" + buildPrompt(rollTraits("aggressive")));
