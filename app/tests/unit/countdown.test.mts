import assert from "node:assert/strict";
import { test } from "node:test";
import { mmss } from "@/features/session/useCountdown";
import { waitText } from "@/server/types";

test("mmss rounds up and never goes negative", () => {
  assert.equal(mmss(225), "03:45");
  assert.equal(mmss(0.2), "00:01");
  assert.equal(mmss(0), "00:00");
  assert.equal(mmss(-5), "00:00");
  assert.equal(mmss(3600), "60:00");
});

test("waitText gives readable retry hints", () => {
  assert.equal(waitText(0.2), "1초");
  assert.equal(waitText(45), "45초");
  assert.equal(waitText(130), "약 2분");
  assert.equal(waitText(7200), "약 2시간");
});
