import { CURRENCIES, type Currency, type InstrumentId } from './types';

/**
 * Market convention for which currency is quoted first in a pair.
 * Earlier in this list = base currency.
 */
const BASE_PRIORITY: readonly Currency[] = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

export const GOLD: InstrumentId = 'XAUUSD';

/** The 28 pairs formed by the eight majors, in conventional base/quote order. */
export const FX_PAIRS: readonly InstrumentId[] = BASE_PRIORITY.flatMap((base, i) =>
  BASE_PRIORITY.slice(i + 1).map((quote) => `${base}${quote}`),
);

export const INSTRUMENTS: readonly InstrumentId[] = [GOLD, ...FX_PAIRS];

const KNOWN = new Set<string>(INSTRUMENTS);
const CURRENCY_SET = new Set<string>(CURRENCIES);

export function isInstrument(id: string): id is InstrumentId {
  return KNOWN.has(id);
}

export function splitPair(id: InstrumentId): { base: string; quote: string } {
  return { base: id.slice(0, 3), quote: id.slice(3, 6) };
}

/**
 * Turn whatever a broker or a user typed into a canonical instrument id.
 * Handles separators ("EUR/USD"), broker suffixes and prefixes
 * ("EURUSD.m", "EURUSDpro", "#XAUUSD"), the "GOLD" alias and the "XAU"
 * shorthand from the command bar. Returns null when nothing matches;
 * callers show closest matches instead of guessing.
 */
export function normaliseSymbol(raw: string): InstrumentId | null {
  const s = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (s === 'XAU' || s === 'GOLD' || s.startsWith('GOLD')) return GOLD;
  for (let i = 0; i + 6 <= s.length; i++) {
    const six = s.slice(i, i + 6);
    if (KNOWN.has(six)) return six;
    // Reversed order (e.g. "USDEUR") is a different price series, not an alias.
  }
  return null;
}

export function isCurrency(code: string): code is Currency {
  return CURRENCY_SET.has(code);
}
