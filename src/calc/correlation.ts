/**
 * Linked pairs (spec section 6).
 *
 * Pearson correlation of bar-to-bar returns over a rolling window
 * (default 50 bars). Flagged when the absolute value is above 0.8.
 */
import type { Bar, InstrumentId } from '../data/types';
import { pearson } from './stats';

/**
 * Bar-to-bar percentage returns of two series on the timestamps they share.
 * A return is only taken between two consecutive shared bars. If one series
 * lacks a bar, both returns span the gap, so the two lists always describe
 * the same stretches of time.
 */
export function alignedReturns(a: readonly Bar[], b: readonly Bar[]): { x: number[]; y: number[]; lastTime: number | null } {
  const x: number[] = [];
  const y: number[] = [];
  let i = 0;
  let j = 0;
  let prevA: number | null = null;
  let prevB: number | null = null;
  let lastTime: number | null = null;
  while (i < a.length && j < b.length) {
    const ta = a[i]!.time;
    const tb = b[j]!.time;
    if (ta < tb) i++;
    else if (tb < ta) j++;
    else {
      const ca = a[i]!.close;
      const cb = b[j]!.close;
      if (prevA !== null && prevB !== null) {
        x.push(ca / prevA - 1);
        y.push(cb / prevB - 1);
      }
      prevA = ca;
      prevB = cb;
      lastTime = ta;
      i++;
      j++;
    }
  }
  return { x, y, lastTime };
}

export interface Link {
  a: InstrumentId;
  b: InstrumentId;
  /** Null when there were too few shared bars or a series did not move. */
  r: number | null;
  /** Returns actually used (at most the window). */
  n: number;
}

/** Correlation of the last `window` shared returns of two series. */
export function correlation(a: readonly Bar[], b: readonly Bar[], window = 50): { r: number | null; n: number } {
  const { x, y } = alignedReturns(a, b);
  const xs = x.slice(-window);
  const ys = y.slice(-window);
  // A short history is reported as missing rather than as a confident number.
  if (xs.length < window) return { r: null, n: xs.length };
  return { r: pearson(xs, ys), n: xs.length };
}

/** Every pairing of the given instruments, in list order. */
export function correlationLinks(series: ReadonlyMap<InstrumentId, readonly Bar[]>, instruments: readonly InstrumentId[], window = 50): Link[] {
  const links: Link[] = [];
  for (let i = 0; i < instruments.length; i++) {
    for (let j = i + 1; j < instruments.length; j++) {
      const a = series.get(instruments[i]!);
      const b = series.get(instruments[j]!);
      const res = a && b ? correlation(a, b, window) : { r: null, n: 0 };
      links.push({ a: instruments[i]!, b: instruments[j]!, ...res });
    }
  }
  return links;
}

export function isFlagged(r: number | null, threshold = 0.8): boolean {
  return r !== null && Math.abs(r) > threshold;
}
