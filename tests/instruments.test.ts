import { describe, expect, it } from 'vitest';
import { FX_PAIRS, INSTRUMENTS, normaliseSymbol, splitPair } from '../src/data/instruments';
import { CURRENCIES } from '../src/data/types';

describe('instrument universe', () => {
  it('has gold plus the 28 pairs of the eight majors', () => {
    expect(FX_PAIRS).toHaveLength(28);
    expect(new Set(FX_PAIRS).size).toBe(28);
    expect(INSTRUMENTS).toHaveLength(29);
    expect(INSTRUMENTS[0]).toBe('XAUUSD');
  });

  it('includes every currency in exactly seven pairs', () => {
    for (const ccy of CURRENCIES) {
      const n = FX_PAIRS.filter((p) => splitPair(p).base === ccy || splitPair(p).quote === ccy).length;
      expect(n, ccy).toBe(7);
    }
  });

  it('uses market quoting order', () => {
    for (const p of ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY', 'EURGBP', 'AUDNZD', 'CADCHF', 'CHFJPY']) {
      expect(FX_PAIRS, p).toContain(p);
    }
    expect(FX_PAIRS).not.toContain('USDEUR');
  });
});

describe('normaliseSymbol', () => {
  it('accepts the forms a user or broker writes', () => {
    expect(normaliseSymbol('xau')).toBe('XAUUSD');
    expect(normaliseSymbol('GOLD')).toBe('XAUUSD');
    expect(normaliseSymbol('XAU/USD')).toBe('XAUUSD');
    expect(normaliseSymbol('eurusd')).toBe('EURUSD');
    expect(normaliseSymbol('EUR/USD')).toBe('EURUSD');
    expect(normaliseSymbol('EURUSD.m')).toBe('EURUSD');
    expect(normaliseSymbol('#GBPJPYpro')).toBe('GBPJPY');
  });

  it('returns null rather than guessing', () => {
    expect(normaliseSymbol('USDEUR')).toBeNull();
    expect(normaliseSymbol('BTCUSD')).toBeNull();
    expect(normaliseSymbol('')).toBeNull();
    expect(normaliseSymbol('HELP')).toBeNull();
  });
});
