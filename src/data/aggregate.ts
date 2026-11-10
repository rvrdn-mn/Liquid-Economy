import type { Bar } from './types';

/**
 * Combine fine bars into coarser ones (e.g. one-minute into hourly).
 * Pure function. A coarse bar is built from whatever fine bars fall inside
 * its window; windows with no fine bars produce no bar. Nothing is filled in.
 *
 * `alignOffsetSeconds` shifts where windows start. 0 aligns to UTC, so daily
 * bars run midnight to midnight UTC.
 */
export function aggregateBars(bars: readonly Bar[], targetSeconds: number, alignOffsetSeconds = 0): Bar[] {
  if (!Number.isInteger(targetSeconds) || targetSeconds <= 0) {
    throw new RangeError('targetSeconds must be a positive whole number');
  }
  const out: Bar[] = [];
  let current: Bar | null = null;
  let volumeKnown = true;
  for (const bar of bars) {
    const start = Math.floor((bar.time + alignOffsetSeconds) / targetSeconds) * targetSeconds - alignOffsetSeconds;
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
