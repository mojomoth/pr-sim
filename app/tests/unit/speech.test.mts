import assert from "node:assert/strict";
import { test } from "node:test";
import { chunks, pickVoice, prosody, voiceSeed } from "@/platform/web/speech";
import { ApiError, ttsFallsBackToBrowser } from "@/features/session/api";

const v = (name: string, lang = "ko-KR", localService = true) => ({ name, lang, localService });
const VOICES = [v("Samantha", "en-US"), v("Google 한국의", "ko-KR", false), v("Yuna"), v("Minsu"), v("Microsoft InJoon Online (Natural) - Korean (Korea)", "ko-KR", false)];

test("pickVoice prefers a Korean voice of the judge's gender", () => {
  assert.deepEqual(pickVoice(VOICES, "female"), { voice: VOICES[2], matched: true });
  assert.deepEqual(pickVoice(VOICES, "male"), { voice: VOICES[3], matched: true });
  // "female" in a name must not count as male
  assert.equal(pickVoice([v("Korean female voice")], "male").matched, false);
  // only a female Korean voice → use it, unmatched (pitch shifts down)
  assert.deepEqual(pickVoice([VOICES[0], VOICES[2]], "male"), { voice: VOICES[2], matched: false });
  assert.deepEqual(pickVoice([VOICES[0]], "female"), { voice: null, matched: false });
  assert.equal(pickVoice([v("유나", "ko_KR")], "female").voice?.name, "유나");
  // macOS Chrome list: standard 유나 beats the novelty Flo; male gets 유나 pitched down (U18: Eddy sounds robotic)
  const mac = ["유나", "Eddy (한국어(대한민국))", "Flo (한국어(대한민국))", "Grandma (한국어(대한민국))"].map((n) => v(n));
  assert.equal(pickVoice([mac[2], ...mac], "female").voice?.name, "유나");
  assert.deepEqual(pickVoice(mac, "male"), { voice: mac[0], matched: false });
  // only novelty voices: a male one still beats nothing
  assert.deepEqual(pickVoice(mac.slice(1), "male"), { voice: mac[1], matched: true });
});

test("pickVoice prefers Premium/Enhanced on-device voices and spreads judges over equal voices", () => {
  const mac = [v("유나"), v("유나(향상됨)"), v("Yuna (Premium)"), v("Google 한국의", "ko-KR", false)];
  assert.equal(pickVoice(mac, "female").voice?.name, "Yuna (Premium)");
  assert.equal(pickVoice(mac.slice(0, 2), "female").voice?.name, "유나(향상됨)");
  // on-device beats a network voice (this is the fallback when the network may be down)
  assert.equal(pickVoice([mac[3], mac[0]], "female").voice?.name, "유나");
  // Android: several equal local male voices → different seeds (judges) get different voices
  const android = [v("ko-kr-x-kob-local"), v("ko-kr-x-koc-local"), v("ko-kr-x-kod-local")].map((x, i) => ({ ...x, name: `${x.name} male ${i}` }));
  const names = new Set([0, 1, 2].map((seed) => pickVoice(android, "male", seed).voice?.name));
  assert.equal(names.size, 3);
  assert.notEqual(voiceSeed({ gender: "male", age: 45, temperament: "strict" }), voiceSeed({ gender: "male", age: 52, temperament: "strict" }));
});

test("prosody: friendly slower/warmer, aggressive faster/lower, unmatched male lower", () => {
  const f = prosody({ gender: "female", age: 40, temperament: "friendly" }, true);
  const s = prosody({ gender: "female", age: 40, temperament: "strict" }, true);
  const a = prosody({ gender: "female", age: 40, temperament: "aggressive" }, true);
  assert.deepEqual(s, { rate: 1, pitch: 1 });
  assert.ok(f.rate < s.rate && f.pitch > s.pitch);
  assert.ok(a.rate > s.rate && a.pitch < s.pitch);
  assert.ok(prosody({ gender: "male", age: 40, temperament: "strict" }, false).pitch < 1);
  assert.ok(prosody({ gender: "male", age: 40, temperament: "strict" }, false).rate < 1);
  assert.ok(prosody({ gender: "male", age: 70, temperament: "strict" }, true).rate < 1);
});

test("chunks splits long text at sentence ends", () => {
  assert.deepEqual(chunks("  첫 문장입니다.  둘째 문장인가요? "), ["첫 문장입니다. 둘째 문장인가요?"]);
  const long = "가".repeat(100) + ". " + "나".repeat(100) + "?";
  assert.deepEqual(chunks(long), ["가".repeat(100) + ".", "나".repeat(100) + "?"]);
  assert.deepEqual(chunks("   "), []);
});

test("ttsFallsBackToBrowser: hint, quota, network, 5xx yes; bad request / abort no", () => {
  assert.equal(ttsFallsBackToBrowser(new ApiError("providers_unavailable", undefined, undefined, 503, "browser")), true);
  assert.equal(ttsFallsBackToBrowser(new ApiError("providers_unavailable", undefined, undefined, 503)), true);
  assert.equal(ttsFallsBackToBrowser(new ApiError("network")), true);
  assert.equal(ttsFallsBackToBrowser(new ApiError("upstream", undefined, undefined, 500)), true);
  assert.equal(ttsFallsBackToBrowser(new ApiError("bad_request", undefined, undefined, 400)), false);
  assert.equal(ttsFallsBackToBrowser(Object.assign(new Error("x"), { name: "AbortError" })), false);
});
