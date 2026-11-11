/**
 * Currency strength (spec section 6).
 *
 * For each of the 28 pairs, take the percentage change over the lookback.
 * For each currency, average the change of every pair it appears in,
 * counting it positive when the currency is the base and negative when it
 * is the quote. Rescale the eight results to 0-100.
 *
 * Pure functions. Missing pairs are left out of the averages, never guessed.
 */
import { CURRENCIES, type Bar, type Currency, type InstrumentId } from '../data/types';
import { percentChange } from './stats';

export interface StrengthResult {
  /** 0 (weakest) to 100 (strongest); null when the currency had no pair with data. */
  score: Record<Currency, number | null>;
  /** The average signed percentage change behind each score. */
  average: Record<Currency, number | null>;
  /** How many of each currency's seven pairs had data. */
  pairsUsed: Record<Currency, number>;
  /** Strongest first. Currencies without a score are left out. */
  ranked: Currency[];
}

const emptyRecord = <T>(value: T) => Object.fromEntries(CURRENCIES.map((c) => [c, value])) as Record<Currency, T>;

export function currencyStrength(changes: ReadonlyMap<InstrumentId, number>): StrengthResult {
  const sum = emptyRecord(0);
  const pairsUsed = emptyRecord(0);
  for (const [pair, change] of changes) {
    if (!Number.isFinite(change)) continue;
    const base = pair.slice(0, 3) as Currency;
    const quote = pair.slice(3, 6) as Currency;
    if (!(base in sum) || !(quote in sum)) continue; // not a pair of two majors, e.g. gold
    sum[base] += change;
    pairsUsed[base] += 1;
    sum[quote] -= change;
    pairsUsed[quote] += 1;
  }

  const average = emptyRecord<number | null>(null);
  for (const c of CURRENCIES) if (pairsUsed[c] > 0) average[c] = sum[c] / pairsUsed[c];

  const known = CURRENCIES.filter((c) => average[c] !== null);
  const values = known.map((c) => average[c]!);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const score = emptyRecord<number | null>(null);
  for (const c of known) {
    // All equal (or a single currency): no strongest or weakest, so mid-scale.
    score[c] = hi === lo ? 50 : ((average[c]! - lo) / (hi - lo)) * 100;
  }
  const ranked = [...known].sort((a, b) => score[b]! - score[a]! || CURRENCIES.indexOf(a) - CURRENCIES.indexOf(b));
  return { score, average, pairsUsed, ranked };
}

/**
 * Close of the last bar that had finished by `time`. A bar's close is known
 * at its end (start + barSeconds), so a bar still forming at `time` is not used.
 */
export function closeAt(bars: readonly Bar[], barSeconds: number, time: number): number | null {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time + barSeconds <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found === -1 ? null : bars[found]!.close;
}

/**
 * Percentage change of one series over a lookback ending at `asOf`.
 * Weekends and gaps are handled by using the last finished bar at each end.
 * Null when there is no finished bar at either end.
 */
export function changeOverLookback(bars: readonly Bar[], barSeconds: number, asOf: number, lookbackSeconds: number): number | null {
  const end = closeAt(bars, barSeconds, asOf);
  const start = closeAt(bars, barSeconds, asOf - lookbackSeconds);
  if (end === null || start === null) return null;
  return percentChange(start, end);
}

/** Strength of the eight currencies at one moment, from the pairs' bars. */
export function strengthAt(
  series: ReadonlyMap<InstrumentId, readonly Bar[]>,
  barSeconds: number,
  asOf: number,
  lookbackSeconds: number,
): StrengthResult {
  const changes = new Map<InstrumentId, number>();
  for (const [pair, bars] of series) {
    const change = changeOverLookback(bars, barSeconds, asOf, lookbackSeconds);
    if (change !== null) changes.set(pair, change);
  }
  return currencyStrength(changes);
}

/** The pair made of two currencies, in market quoting order, if it is one of the 28. */
export function pairOf(a: Currency, b: Currency, pairs: readonly InstrumentId[]): InstrumentId | null {
  return pairs.find((p) => p === `${a}${b}` || p === `${b}${a}`) ?? null;
}
