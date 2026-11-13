import assert from "node:assert/strict";
import { test } from "node:test";
import { pickVoice, prosody, voiceSeed } from "@/platform/web/speech";
test("empty / non-Korean voice lists", () => {
  for (const g of ["male", "female"] as const) {
    assert.deepEqual(pickVoice([], g, 7), { voice: null, matched: false });
    assert.deepEqual(pickVoice([{ name: "Samantha", lang: "en-US" }], g, -3), { voice: null, matched: false });
  }
  const p = { gender: "male", age: 45, temperament: "strict" } as const;
  assert.ok(Number.isFinite(voiceSeed(p)));
  console.log(JSON.stringify(prosody(p, false)));
});
