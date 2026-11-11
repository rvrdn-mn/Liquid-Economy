/** Replay clock arithmetic. Pure; the timer that drives it lives in the hub. */

export interface Extent {
  first: number;
  last: number;
}

export function clampReplay(time: number, extent: Extent): number {
  return Math.min(extent.last, Math.max(extent.first, time));
}

/** Move by `count` steps (negative goes back). `atEnd` is true when a limit was hit. */
export function stepReplay(time: number, stepSeconds: number, count: number, extent: Extent): { time: number; atEnd: boolean } {
  const wanted = time + stepSeconds * count;
  const clamped = clampReplay(wanted, extent);
  return { time: clamped, atEnd: clamped === extent.last || clamped === extent.first };
}

/** Round a moment down to a whole step, so replay moves bar by bar. */
export function snapToStep(time: number, stepSeconds: number): number {
  return Math.floor(time / stepSeconds) * stepSeconds;
}
