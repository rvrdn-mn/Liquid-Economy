/** How the liquid machine turns numbers into shapes. Pure, so it can be tested. */
import type { LinkDirection } from '../../calc/drivers';

/** Thinnest and thickest pipe, as fractions of the drawing's height. */
export const PIPE_MIN = 0.006;
export const PIPE_MAX = 0.07;

/**
 * Pipe thickness for a link: grows in step with the strength of the
 * correlation, whatever its sign. A missing link gets the thinnest pipe.
 */
export function pipeThickness(r: number | null, height: number): number {
  const strength = r === null ? 0 : Math.min(1, Math.abs(r));
  return (PIPE_MIN + (PIPE_MAX - PIPE_MIN) * strength) * height;
}

export const DIRECTION_COLORS: Record<LinkDirection, readonly [number, number, number]> = {
  with: [57, 135, 229], // moving with gold (blue)
  against: [217, 89, 38], // moving against gold (orange)
  none: [110, 116, 126], // no reading
};

export const DIRECTION_WORDS: Record<LinkDirection, string> = {
  with: 'with gold',
  against: 'against gold',
  none: 'no reading',
};

/** How fast the flow marks travel along a pipe, in pipe lengths per second. */
export function flowSpeed(r: number | null): number {
  return r === null ? 0 : 0.08 + 0.5 * Math.min(1, Math.abs(r));
}

/** Liquid height in a tank for a 0..1 level, keeping a sliver visible at the extremes. */
export function fillFraction(level: number | null): number {
  if (level === null) return 0;
  return 0.06 + 0.88 * Math.min(1, Math.max(0, level));
}
