/** How the Q&A hero makes room for the live answer: answer lines, face card height (undefined = full), or the avatar row. */
export interface HeroFit {
  lines: 2 | 3;
  height?: number;
  compact: boolean;
}

/**
 * `deficit`: px the 3-line answer would still reach into the mic row once the full-size hero (`fullH`) has
 * scrolled up to the sticky header. Room is made in this order, so the face card stays the focal point
 * (DESIGN.md): answer down to 2 lines, then a shorter face card (down to `minH`), and only then the avatar row.
 */
export function heroFit(deficit: number, line: number, fullH: number, minH = 140): HeroFit | null {
  if (deficit <= 1) return null;
  const height = Math.floor(fullH - Math.max(0, deficit - line));
  if (height < minH) return { lines: 3, compact: true };
  return { lines: 2, height: height < fullH ? height : undefined, compact: false };
}

/** Same layout, give or take a pixel (rounding in a scaled frame must not re-render in a loop). */
export function sameFit(a: HeroFit | null, b: HeroFit | null) {
  if (!a || !b) return a === b;
  return a.lines === b.lines && a.compact === b.compact && Math.abs((a.height ?? 1e4) - (b.height ?? 1e4)) <= 1;
}
