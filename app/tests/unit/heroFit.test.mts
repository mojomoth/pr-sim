import assert from "node:assert/strict";
import { test } from "node:test";
import { heroFit, sameFit } from "@/app/qa/heroFit";

test("heroFit keeps the full face card when the answer fits", () => {
  assert.equal(heroFit(0, 26, 186), null);
  assert.equal(heroFit(1, 26, 186), null);
  assert.equal(heroFit(-40, 26, 186), null);
});

test("heroFit caps the answer at 2 lines before shrinking the face card", () => {
  assert.deepEqual(heroFit(20, 26, 186), { lines: 2, height: undefined, compact: false });
  assert.deepEqual(heroFit(26, 26, 186), { lines: 2, height: undefined, compact: false });
});

test("heroFit shortens the face card down to the floor, then falls back to the avatar row", () => {
  assert.deepEqual(heroFit(43, 26, 186), { lines: 2, height: 169, compact: false });
  assert.deepEqual(heroFit(72, 26, 186), { lines: 2, height: 140, compact: false });
  assert.deepEqual(heroFit(73, 26, 186), { lines: 3, compact: true });
  assert.deepEqual(heroFit(30, 26, 140), { lines: 3, compact: true });
});

test("sameFit ignores a 1px rounding difference", () => {
  assert.equal(sameFit(null, null), true);
  assert.equal(sameFit(null, heroFit(30, 26, 186)), false);
  assert.equal(sameFit({ lines: 2, height: 159, compact: false }, { lines: 2, height: 160, compact: false }), true);
  assert.equal(sameFit({ lines: 2, height: 159, compact: false }, { lines: 2, height: 161, compact: false }), false);
  assert.equal(sameFit({ lines: 2, compact: false }, { lines: 2, height: 185, compact: false }), false);
  assert.equal(sameFit({ lines: 3, compact: true }, { lines: 3, compact: true }), true);
});
