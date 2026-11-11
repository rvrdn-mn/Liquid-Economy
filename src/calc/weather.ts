/**
 * The weather map's three readings per currency. The same numbers as the
 * strength board and volatility panel, regrouped by currency:
 *
 *  pressure  the strength score, 0-100 (high pressure = strong)
 *  wind      how much that score changed over the last few bars
 *  storm     the average volatility ratio of the currency's seven pairs
 */
import { CURRENCIES, type Currency, type InstrumentId } from '../data/types';

/** Average volatility ratio of the pairs each currency appears in. Null when none has a reading. */
export function currencyVolatility(pairRatios: ReadonlyMap<InstrumentId, number>): Record<Currency, number | null> {
  const sum = Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Record<Currency, number>;
  const n = Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Record<Currency, number>;
  for (const [pair, ratio] of pairRatios) {
    if (!Number.isFinite(ratio)) continue;
    const base = pair.slice(0, 3) as Currency;
    const quote = pair.slice(3, 6) as Currency;
    if (!(base in sum) || !(quote in sum)) continue; // not a pair of two majors, e.g. gold
    for (const c of [base, quote]) {
      sum[c] += ratio;
      n[c] += 1;
    }
  }
  return Object.fromEntries(CURRENCIES.map((c) => [c, n[c] > 0 ? sum[c] / n[c] : null])) as Record<Currency, number | null>;
}

/** Change in a score over the last `bars` steps of its history: latest minus earlier. */
export function scoreChange(history: readonly (number | null)[], bars: number): number | null {
  const last = history[history.length - 1];
  const earlier = history[history.length - 1 - bars];
  if (last === null || last === undefined || earlier === null || earlier === undefined) return null;
  return last - earlier;
}

export type StormLevel = 'calm' | 'breezy' | 'stormy' | 'severe';

/** Volatility ratio at which each level starts. 1 is the currency's own usual level. */
export const STORM_LEVELS: readonly { level: StormLevel; from: number }[] = [
  { level: 'severe', from: 1.8 },
  { level: 'stormy', from: 1.4 },
  { level: 'breezy', from: 1.1 },
  { level: 'calm', from: 0 },
];

export function stormLevel(ratio: number | null): StormLevel {
  if (ratio === null) return 'calm';
  return STORM_LEVELS.find((l) => ratio >= l.from)!.level;
}

export interface CurrencyWeather {
  currency: Currency;
  pressure: number | null;
  wind: number | null;
  storm: number | null;
  level: StormLevel;
}
