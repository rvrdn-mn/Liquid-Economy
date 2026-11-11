/**
 * Volatility (spec section 6).
 *
 * Average true range over 14 bars, as a percentage of price. Compared with
 * the same measure averaged over the last 20 days to get a ratio: above 1
 * means busier than usual.
 *
 * The average is a plain mean of the last `period` true ranges.
 */
import type { Bar } from '../data/types';

/**
 * True range of each bar: the largest of high-low, |high - previous close|
 * and |low - previous close|. The first bar has no previous close, so its
 * true range is simply high-low.
 */
export function trueRanges(bars: readonly Bar[]): number[] {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prev = bars[i - 1]!.close;
    return Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
  });
}

/**
 * ATR as a percentage of the bar's close, for every bar. Entries are null
 * until `period` true ranges that each have a previous close exist.
 */
export function atrPercentSeries(bars: readonly Bar[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new RangeError('period must be a positive whole number');
  const tr = trueRanges(bars);
  const out: (number | null)[] = new Array<number | null>(bars.length).fill(null);
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    sum += tr[i]!;
    if (i > period) sum -= tr[i - period]!;
    if (i >= period) out[i] = (sum / period / bars[i]!.close) * 100;
  }
  return out;
}

export interface VolatilityReading {
  /** ATR% at the latest bar. */
  current: number;
  /** Mean ATR% over the baseline window. */
  baseline: number;
  /** current / baseline. Above 1: busier than usual. */
  ratio: number;
  /** Bars that contributed to the baseline. */
  baselineBars: number;
}

/**
 * Current ATR% against its own average over the last `baselineDays` days
 * (counted back from the latest bar). Null when there are not enough bars.
 */
export function volatilityReading(bars: readonly Bar[], period = 14, baselineDays = 20): VolatilityReading | null {
  const atr = atrPercentSeries(bars, period);
  const lastIndex = bars.length - 1;
  const current = lastIndex >= 0 ? atr[lastIndex] : null;
  if (current === null || current === undefined) return null;
  const from = bars[lastIndex]!.time - baselineDays * 86400;
  let sum = 0;
  let n = 0;
  for (let i = lastIndex; i >= 0 && bars[i]!.time > from; i--) {
    const v = atr[i];
    if (v === null || v === undefined) continue;
    sum += v;
    n++;
  }
  if (n === 0) return null;
  const baseline = sum / n;
  if (baseline === 0) return null;
  return { current, baseline, ratio: current / baseline, baselineBars: n };
}

/** The bar with the widest true range as a percentage of its close; null for fewer than two bars. */
export function widestBar(bars: readonly Bar[]): { bar: Bar; rangePercent: number } | null {
  const tr = trueRanges(bars);
  let best = -1;
  let bestValue = -Infinity;
  for (let i = 1; i < bars.length; i++) {
    const value = (tr[i]! / bars[i]!.close) * 100;
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  return best === -1 ? null : { bar: bars[best]!, rangePercent: bestValue };
}
