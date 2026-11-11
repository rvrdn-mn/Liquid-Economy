/**
 * Gold drivers (spec section 6).
 *
 * Rolling correlation of gold's daily returns against each driver's daily
 * changes (default 30 daily bars). Pure.
 *
 * "Change" depends on the driver. For a price or an index it is the
 * percentage change. For a yield, which is already a percentage, it is the
 * plain difference in percentage points.
 */
import { pearson } from './stats';

export interface Point {
  /** UTC midnight of the day the value belongs to, in epoch seconds. */
  time: number;
  value: number;
}

export type ChangeKind = 'percent' | 'difference';

const change = (from: number, to: number, kind: ChangeKind) => (kind === 'percent' ? (to / from - 1) * 100 : to - from);

/**
 * Day-to-day changes of two series on the days they share. A change is
 * taken between two consecutive shared days, so if one series lacks a day
 * both changes span the gap.
 */
export function alignedChanges(a: readonly Point[], kindA: ChangeKind, b: readonly Point[], kindB: ChangeKind): { x: number[]; y: number[]; times: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  const times: number[] = [];
  let i = 0;
  let j = 0;
  let prevA: number | null = null;
  let prevB: number | null = null;
  while (i < a.length && j < b.length) {
    const pa = a[i]!;
    const pb = b[j]!;
    if (pa.time < pb.time) i++;
    else if (pb.time < pa.time) j++;
    else {
      if (prevA !== null && prevB !== null) {
        x.push(change(prevA, pa.value, kindA));
        y.push(change(prevB, pb.value, kindB));
        times.push(pa.time);
      }
      prevA = pa.value;
      prevB = pb.value;
      i++;
      j++;
    }
  }
  return { x, y, times };
}

export interface DriverLink {
  /** Correlation over the last `window` shared changes; null when there are too few. */
  r: number | null;
  /** The same measure one shared day earlier, for "change since yesterday". */
  rPrevious: number | null;
  /** Shared changes available (may exceed the window). */
  n: number;
  /** Day of the latest shared change. */
  lastTime: number | null;
}

/** How closely a driver has moved with gold over the last `window` shared days. */
export function driverLink(gold: readonly Point[], driver: readonly Point[], driverKind: ChangeKind, window = 30): DriverLink {
  const { x, y, times } = alignedChanges(gold, 'percent', driver, driverKind);
  const n = x.length;
  const at = (end: number) => (end < window ? null : pearson(x.slice(end - window, end), y.slice(end - window, end)));
  return { r: at(n), rPrevious: at(n - 1), n, lastTime: times[n - 1] ?? null };
}

export type LinkDirection = 'with' | 'against' | 'none';

/** Whether a driver has been moving with gold or against it. */
export function linkDirection(r: number | null): LinkDirection {
  if (r === null || r === 0) return 'none';
  return r > 0 ? 'with' : 'against';
}

/** Where the latest value sits in the range of the last `window` values: 0 at the low, 1 at the high. */
export function levelInRange(points: readonly Point[], window = 30): number | null {
  const recent = points.slice(-window);
  if (recent.length < 2) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of recent) {
    lo = Math.min(lo, p.value);
    hi = Math.max(hi, p.value);
  }
  if (hi === lo) return 0.5;
  return (recent[recent.length - 1]!.value - lo) / (hi - lo);
}

/** Latest value and its change from the day before. */
export function latestMove(points: readonly Point[], kind: ChangeKind): { value: number; change: number; time: number } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  return { value: last.value, change: change(prev.value, last.value, kind), time: last.time };
}

/**
 * A running index from daily percentage moves, starting at 100. Used to
 * turn the dollar's daily average move into a level.
 */
export function indexFromMoves(moves: readonly { time: number; percent: number }[], start = 100): Point[] {
  const out: Point[] = [];
  let level = start;
  for (const m of moves) {
    level *= 1 + m.percent / 100;
    out.push({ time: m.time, value: level });
  }
  return out;
}
