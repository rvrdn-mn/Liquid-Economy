import type { Bar } from './types';

/** Where four-hour and daily bars begin. */
export type DayRoll =
  /** The forex convention: the trading day rolls at 17:00 New York time. */
  | 'ny17'
  /** Midnight UTC. */
  | 'utc';

const HOUR = 3600;
const DAY = 86400;

/** UTC seconds of the n-th Sunday of a month at a given UTC hour. */
function nthSundayUtc(year: number, monthIndex: number, n: number, utcHour: number): number {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
  return Date.UTC(year, monthIndex, firstSunday + (n - 1) * 7, utcHour) / 1000;
}

/**
 * New York's offset from UTC in seconds: -4 h in daylight time, else -5 h.
 * US rule since 2007: second Sunday of March to first Sunday of November,
 * changing at 02:00 local time.
 */
export function newYorkOffsetSeconds(time: number): number {
  const year = new Date(time * 1000).getUTCFullYear();
  const start = nthSundayUtc(year, 2, 2, 7); // 02:00 EST = 07:00 UTC
  const end = nthSundayUtc(year, 10, 1, 6); // 02:00 EDT = 06:00 UTC
  return time >= start && time < end ? -4 * HOUR : -5 * HOUR;
}

/**
 * Start of the window a bar belongs to.
 *
 * Under 'ny17', four-hour windows count from 17:00 New York, and a daily
 * bar is stamped with midnight UTC of its trading date, so Sunday evening's
 * opening hours belong to Monday's bar, as on a broker's daily chart.
 */
export function windowStart(time: number, targetSeconds: number, dayRoll: DayRoll): number {
  if (dayRoll === 'utc' || targetSeconds < 4 * HOUR) {
    return Math.floor(time / targetSeconds) * targetSeconds;
  }
  // Shift so that 17:00 New York lands on a day boundary.
  const shift = newYorkOffsetSeconds(time) + 7 * HOUR;
  const start = Math.floor((time + shift) / targetSeconds) * targetSeconds;
  return targetSeconds >= DAY ? start : start - shift;
}

/**
 * Combine fine bars into coarser ones (e.g. one-minute into hourly).
 * Pure function. A coarse bar is built from whatever fine bars fall inside
 * its window; windows with no fine bars produce no bar. Nothing is filled in.
 */
export function aggregateBars(bars: readonly Bar[], targetSeconds: number, dayRoll: DayRoll = 'utc'): Bar[] {
  if (!Number.isInteger(targetSeconds) || targetSeconds <= 0) {
    throw new RangeError('targetSeconds must be a positive whole number');
  }
  const out: Bar[] = [];
  let current: Bar | null = null;
  let volumeKnown = true;
  for (const bar of bars) {
    const start = windowStart(bar.time, targetSeconds, dayRoll);
    if (current && current.time === start) {
      if (bar.high > current.high) current.high = bar.high;
      if (bar.low < current.low) current.low = bar.low;
      current.close = bar.close;
      if (volumeKnown && bar.volume !== undefined && current.volume !== undefined) current.volume += bar.volume;
      else {
        volumeKnown = false;
        delete current.volume;
      }
    } else {
      if (current && current.time > start) throw new RangeError('bars must be in ascending time order');
      current = { time: start, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
      volumeKnown = bar.volume !== undefined;
      if (volumeKnown) current.volume = bar.volume!;
      out.push(current);
    }
  }
  return out;
}

/** Number of bars whose value of `key` is at most `limit`. Bars must be ascending. */
export function countUpTo(bars: readonly Bar[], limit: number, key: (bar: Bar) => number = (b) => b.time): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(bars[mid]!) <= limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
