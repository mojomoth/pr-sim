// Unit tests for the pure gesture math. Run from pocs/: node --test slide/tests/swipe.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPan, decideRelease, dragOffset, fitContain, outputScale, rubberBand, VelocityTracker, MAX_CANVAS_PIXELS } from "../lib/swipe.ts";

test("rubberBand resists and never exceeds the stage", () => {
  assert.equal(rubberBand(0, 300), 0);
  const r = rubberBand(200, 300);
  assert.ok(r > 0 && r < 200, `got ${r}`);
  assert.ok(rubberBand(10_000, 300) < 300);
  assert.equal(rubberBand(-200, 300), -r);
});

test("dragOffset: free in the middle, rubber-band at the ends, max one page", () => {
  assert.equal(dragOffset(-100, 3, 12, 300), -100);
  assert.equal(dragOffset(-900, 3, 12, 300), -300);
  assert.ok(dragOffset(100, 0, 12, 300) < 100);
  assert.ok(dragOffset(-100, 11, 12, 300) > -100);
});

test("decideRelease: distance threshold, flick, clamping", () => {
  const base = { width: 300, index: 3, total: 12 };
  assert.equal(decideRelease({ ...base, dx: -30, vx: 0 }), 3); // too short
  assert.equal(decideRelease({ ...base, dx: -80, vx: 0 }), 4); // > 22%
  assert.equal(decideRelease({ ...base, dx: 80, vx: 0 }), 2);
  assert.equal(decideRelease({ ...base, dx: -20, vx: -0.8 }), 4); // flick
  assert.equal(decideRelease({ ...base, dx: -20, vx: 0.8 }), 3); // velocity against direction
  assert.equal(decideRelease({ ...base, index: 0, dx: 200, vx: 1 }), 0);
  assert.equal(decideRelease({ ...base, index: 11, dx: -200, vx: -1 }), 11);
});

test("VelocityTracker ignores held fingers", () => {
  const v = new VelocityTracker();
  v.reset(0, 0);
  v.push(-50, 40);
  assert.equal(v.velocity(45), -50 / 40);
  assert.equal(v.velocity(200), 0);
});

test("fitContain keeps aspect for landscape decks and portrait A4", () => {
  assert.deepEqual(fitContain(960, 540, 320, 400), { width: 320, height: 180, scale: 1 / 3 });
  const a4 = fitContain(595, 842, 342, 400);
  assert.ok(a4.height === 400 && a4.width < 342);
});

test("outputScale honours dpr/zoom and caps canvas area", () => {
  assert.equal(outputScale(300, 200, 2), 2);
  assert.equal(outputScale(300, 200, 2, 2), 4);
  const os = outputScale(1000, 800, 3, 4);
  assert.ok(1000 * 800 * os * os <= MAX_CANVAS_PIXELS + 1);
});

test("clampPan prevents revealing empty space", () => {
  assert.equal(clampPan(500, 300, 2), 150);
  assert.equal(clampPan(-500, 300, 2), -150);
  assert.equal(clampPan(50, 300, 1), 0);
});
