// Pure gesture math for the slide viewer (no DOM).

/** Pixels the finger must travel before we decide the gesture axis. */
export const AXIS_LOCK_PX = 8;
/** Fraction of the stage width that commits a page change on release. */
const DISTANCE_THRESHOLD = 0.22;
/** Release velocity (px/ms) that commits a page change regardless of distance ("flick"). */
const FLICK_VELOCITY = 0.45;
/** Minimum travel for a flick to count (avoid tap jitter turning pages). */
const FLICK_MIN_PX = 12;
/** Snap/settle animation duration. DESIGN.md: 180–240ms, reduced-motion → none. */
export const SNAP_MS = 200;
export const SNAP_EASING = "cubic-bezier(0.22, 0.8, 0.24, 1)";

/**
 * iOS-style rubber-band: the further you pull past the edge, the less it moves.
 * Returns the visual offset for a raw finger offset `x` on a stage `dim` px wide.
 */
function rubberBand(x: number, dim: number, c = 0.55): number {
  if (dim <= 0) return 0;
  const sign = Math.sign(x);
  const a = Math.abs(x);
  return sign * (1 - 1 / ((a * c) / dim + 1)) * dim;
}

/**
 * Visual drag offset: free between pages, rubber-banded when pulling past the first/last page.
 * dx > 0 means the finger moved right (towards the previous page).
 */
export function dragOffset(dx: number, index: number, total: number, width: number): number {
  const atStart = index <= 0 && dx > 0;
  const atEnd = index >= total - 1 && dx < 0;
  if (atStart || atEnd || total <= 1) return rubberBand(dx, width);
  // Never let a single drag travel more than one page.
  return Math.max(-width, Math.min(width, dx));
}

interface ReleaseInput {
  dx: number; // total horizontal travel (px), + = right
  vx: number; // release velocity (px/ms), + = right
  width: number; // stage width (px)
  index: number; // current 0-based page index
  total: number;
}

/** Decide the target page index on release: velocity flick OR distance threshold, clamped. */
export function decideRelease({ dx, vx, width, index, total }: ReleaseInput): number {
  let dir = 0;
  const flick = Math.abs(vx) >= FLICK_VELOCITY && Math.abs(dx) >= FLICK_MIN_PX && Math.sign(vx) === Math.sign(dx);
  if (flick) dir = vx < 0 ? 1 : -1;
  else if (Math.abs(dx) >= width * DISTANCE_THRESHOLD) dir = dx < 0 ? 1 : -1;
  return clampIndex(index + dir, total);
}

export function clampIndex(i: number, total: number): number {
  return Math.max(0, Math.min(Math.max(0, total - 1), i));
}

/** Velocity tracker: keeps the last ~100ms of samples and returns px/ms. */
export class VelocityTracker {
  private samples: { x: number; t: number }[] = [];
  private windowMs: number;
  constructor(windowMs = 100) {
    this.windowMs = windowMs;
  }
  reset(x: number, t: number) {
    this.samples = [{ x, t }];
  }
  push(x: number, t: number) {
    this.samples.push({ x, t });
    const cutoff = t - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }
  velocity(now: number): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const last = s[s.length - 1];
    // Finger held still before release → no flick.
    if (now - last.t > 80) return 0;
    const first = s[0];
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0;
  }
}

/** Fit a page (pw × ph, PDF points) inside a box (bw × bh, CSS px) keeping aspect ratio. */
export function fitContain(pw: number, ph: number, bw: number, bh: number) {
  if (pw <= 0 || ph <= 0 || bw <= 0 || bh <= 0) return { width: 0, height: 0, scale: 0 };
  const scale = Math.min(bw / pw, bh / ph);
  return { width: Math.floor(pw * scale), height: Math.floor(ph * scale), scale };
}

/** Max canvas backing-store pixels (≈ 16.7M is the iOS Safari limit; keep well below). */
const MAX_CANVAS_PIXELS = 12_000_000;

/** Device-pixel scale for a canvas of cssW×cssH, capped so the backing store stays under the limit. */
export function outputScale(cssW: number, cssH: number, dpr: number, zoom = 1): number {
  const want = Math.max(1, dpr) * Math.max(1, zoom);
  const area = cssW * cssH * want * want;
  if (area <= MAX_CANVAS_PIXELS) return want;
  return Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH));
}

/** Clamp a pan offset so a zoomed page never reveals empty space beyond its edges. */
export function clampPan(pan: number, size: number, zoom: number): number {
  const max = Math.max(0, (size * zoom - size) / 2);
  return Math.max(-max, Math.min(max, pan));
}
