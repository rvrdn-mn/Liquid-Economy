import { describe, expect, it } from 'vitest';
import { alignedReturns, correlation, correlationLinks, isFlagged } from '../src/calc/correlation';
import { hourlyRangeProfile, sessionHoursUtc, sessionsOpenAt } from '../src/calc/session';
import { mean, pearson, percentChange } from '../src/calc/stats';
import { changeOverLookback, closeAt, currencyStrength, pairOf, strengthAt } from '../src/calc/strength';
import { atrPercentSeries, trueRanges, volatilityReading } from '../src/calc/volatility';
import { FX_PAIRS } from '../src/data/instruments';
import type { Bar } from '../src/data/types';

// Small made-up series, used only to check the arithmetic by hand.

const DAY = 86400;
const at = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
const flat = (time: number, price: number): Bar => ({ time, open: price, high: price, low: price, close: price });

describe('stats', () => {
  it('mean and percentage change', () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
    expect(mean([])).toBeNull();
    expect(percentChange(200, 203)).toBeCloseTo(1.5, 12);
    expect(percentChange(100, 90)).toBeCloseTo(-10, 12);
  });

  it('pearson correlation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    // By hand: x=[1,2,3,4,5], y=[2,1,4,3,5] -> sxy=8, sxx=10, syy=10 -> 0.8
    expect(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 12);
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull(); // no variation
    expect(pearson([1, 2], [1, 2])).toBeNull(); // too few points
    expect(() => pearson([1, 2, 3], [1, 2])).toThrow(RangeError);
  });
});

describe('currency strength', () => {
  it('follows the spec on a three-pair example worked by hand', () => {
    // EURUSD +1%, USDJPY +2%, EURJPY +3%.
    // EUR: base in both of its pairs        -> (+1 +3) / 2 = +2
    // USD: quote in EURUSD, base in USDJPY  -> (-1 +2) / 2 = +0.5
    // JPY: quote in both                    -> (-2 -3) / 2 = -2.5
    // Rescaled to 0-100: EUR 100, JPY 0, USD (0.5 + 2.5) / 4.5 * 100 = 66.67
    const r = currencyStrength(new Map([['EURUSD', 1], ['USDJPY', 2], ['EURJPY', 3]]));
    expect(r.average.EUR).toBeCloseTo(2, 12);
    expect(r.average.USD).toBeCloseTo(0.5, 12);
    expect(r.average.JPY).toBeCloseTo(-2.5, 12);
    expect(r.score.EUR).toBe(100);
    expect(r.score.JPY).toBe(0);
    expect(r.score.USD).toBeCloseTo(66.6667, 3);
    expect(r.ranked).toEqual(['EUR', 'USD', 'JPY']);
    expect(r.pairsUsed).toMatchObject({ EUR: 2, USD: 2, JPY: 2, GBP: 0 });
    expect(r.score.GBP).toBeNull(); // no data, so no score
  });

  it('ignores instruments that are not a pair of two majors, and non-numbers', () => {
    const r = currencyStrength(new Map([['XAUUSD', 5], ['EURUSD', 1], ['GBPUSD', NaN]]));
    expect(r.pairsUsed.USD).toBe(1);
    expect(r.average.USD).toBeCloseTo(-1, 12);
  });

  it('gives mid-scale when nothing stands out', () => {
    const r = currencyStrength(new Map([['EURUSD', 0], ['USDJPY', 0], ['EURJPY', 0]]));
    expect([r.score.EUR, r.score.USD, r.score.JPY]).toEqual([50, 50, 50]);
    expect(currencyStrength(new Map()).ranked).toEqual([]);
  });

  it('uses only finished bars when measuring a change', () => {
    // Daily bars Mon 5 Jan to Wed 7 Jan 2026.
    const bars = [flat(at(2026, 1, 5), 100), flat(at(2026, 1, 6), 102), flat(at(2026, 1, 7), 105)];
    expect(closeAt(bars, DAY, at(2026, 1, 7))).toBe(102); // Wednesday's bar has only just started
    expect(closeAt(bars, DAY, at(2026, 1, 8))).toBe(105);
    expect(closeAt(bars, DAY, at(2026, 1, 5, 12))).toBeNull(); // nothing finished yet
    // 24 hours back from the end of Wednesday: Tuesday's close 102 -> 105.
    expect(changeOverLookback(bars, DAY, at(2026, 1, 8), DAY)).toBeCloseTo((105 / 102 - 1) * 100, 12);
    expect(changeOverLookback(bars, DAY, at(2026, 1, 8), 10 * DAY)).toBeNull();
  });

  it('looks back across a weekend to the last finished bar', () => {
    // Friday 9 Jan and Monday 12 Jan 2026.
    const bars = [flat(at(2026, 1, 9), 200), flat(at(2026, 1, 12), 210)];
    expect(changeOverLookback(bars, DAY, at(2026, 1, 13), DAY)).toBeCloseTo(5, 12);
  });

  it('computes strength from bars and names the strongest-weakest pair', () => {
    const series = new Map<string, Bar[]>([
      ['EURUSD', [flat(at(2026, 1, 5), 1), flat(at(2026, 1, 6), 1.01)]],
      ['USDJPY', [flat(at(2026, 1, 5), 100), flat(at(2026, 1, 6), 102)]],
      ['EURJPY', [flat(at(2026, 1, 5), 100), flat(at(2026, 1, 6), 103)]],
    ]);
    const r = strengthAt(series, DAY, at(2026, 1, 7), DAY);
    expect(r.ranked).toEqual(['EUR', 'USD', 'JPY']);
    expect(pairOf(r.ranked[0]!, r.ranked[2]!, FX_PAIRS)).toBe('EURJPY');
    expect(pairOf('JPY', 'USD', FX_PAIRS)).toBe('USDJPY');
  });
});

describe('volatility', () => {
  // O, H, L, C
  const mk = (i: number, h: number, l: number, c: number): Bar => ({ time: at(2026, 1, 5) + i * DAY, open: c, high: h, low: l, close: c });
  const bars = [mk(0, 11, 9, 10), mk(1, 12, 10, 11), mk(2, 16, 12, 15), mk(3, 15, 9, 10), mk(4, 11, 10, 10)];

  it('true range uses the previous close when the bar gapped', () => {
    // bar2: high-low 4, |16-11| 5, |12-11| 1 -> 5.  bar3: 6, |15-15| 0, |9-15| 6 -> 6.
    expect(trueRanges(bars)).toEqual([2, 2, 5, 6, 1]);
  });

  it('ATR is the plain mean of the last N true ranges, as a percentage of the close', () => {
    const atr = atrPercentSeries(bars, 2);
    expect(atr[0]).toBeNull();
    expect(atr[1]).toBeNull(); // only one true range with a previous close so far
    expect(atr[2]).toBeCloseTo(((2 + 5) / 2 / 15) * 100, 12);
    expect(atr[3]).toBeCloseTo(((5 + 6) / 2 / 10) * 100, 12);
    expect(atr[4]).toBeCloseTo(((6 + 1) / 2 / 10) * 100, 12);
    expect(() => atrPercentSeries(bars, 0)).toThrow(RangeError);
  });

  it('compares the current value with its own recent average', () => {
    // period 2, baseline 2 days back from the last bar: bars 3 and 4 only.
    const r = volatilityReading(bars, 2, 2)!;
    expect(r.current).toBeCloseTo(35, 12);
    expect(r.baseline).toBeCloseTo((55 + 35) / 2, 12);
    expect(r.ratio).toBeCloseTo(35 / 45, 12);
    expect(r.baselineBars).toBe(2);
    expect(volatilityReading(bars.slice(0, 2), 2, 20)).toBeNull(); // not enough bars
    expect(volatilityReading([], 14, 20)).toBeNull();
  });
});

describe('linked pairs', () => {
  const s = (closes: (number | null)[], start = 0): Bar[] =>
    closes.flatMap((c, i) => (c === null ? [] : [flat(at(2026, 1, 5) + (start + i) * DAY, c)]));

  it('takes returns only on bars both series have', () => {
    const a = s([100, 110, 121, 133.1]);
    const b = s([50, null, 60, 66]); // b lacks the second day
    const { x, y } = alignedReturns(a, b);
    expect(x.map((v) => +v.toFixed(6))).toEqual([0.21, 0.1]); // 100 -> 121 spans the gap, then 121 -> 133.1
    expect(y.map((v) => +v.toFixed(6))).toEqual([0.2, 0.1]);
  });

  it('reports a short history as missing, not as a number', () => {
    const a = s([1, 2, 3, 4, 5, 6]);
    const b = s([2, 4, 5, 9, 10, 13]);
    expect(correlation(a, b, 50)).toEqual({ r: null, n: 5 });
    expect(correlation(a, b, 5).r).not.toBeNull();
  });

  it('uses the last N returns and finds perfect links', () => {
    const up = s([100, 101, 103, 102, 106, 107]);
    const same = s([10, 10.1, 10.3, 10.2, 10.6, 10.7]);
    const inverse = s([1 / 100, 1 / 101, 1 / 103, 1 / 102, 1 / 106, 1 / 107]);
    expect(correlation(up, same, 5).r).toBeCloseTo(1, 9);
    expect(correlation(up, inverse, 5).r!).toBeLessThan(-0.99);
    const links = correlationLinks(new Map([['EURUSD', up], ['GBPUSD', same], ['USDCHF', inverse]]), ['EURUSD', 'GBPUSD', 'USDCHF', 'USDJPY'], 5);
    expect(links.map((l) => `${l.a}-${l.b}`)).toEqual(['EURUSD-GBPUSD', 'EURUSD-USDCHF', 'EURUSD-USDJPY', 'GBPUSD-USDCHF', 'GBPUSD-USDJPY', 'USDCHF-USDJPY']);
    expect(links[2]).toEqual({ a: 'EURUSD', b: 'USDJPY', r: null, n: 0 }); // no data for USDJPY
  });

  it('flags above the threshold in either direction', () => {
    expect(isFlagged(0.81)).toBe(true);
    expect(isFlagged(-0.95)).toBe(true);
    expect(isFlagged(0.8)).toBe(false);
    expect(isFlagged(null)).toBe(false);
    expect(isFlagged(0.6, 0.5)).toBe(true);
  });
});

describe('sessions', () => {
  it('converts each centre\'s business hours to UTC, following its daylight saving', () => {
    const july = Object.fromEntries(sessionHoursUtc(at(2026, 7, 15, 12)).map((s) => [s.name, [s.openUtc, s.closeUtc]]));
    expect(july).toEqual({ Asia: [0, 9], London: [7, 16], 'New York': [12, 21] });
    const january = Object.fromEntries(sessionHoursUtc(at(2026, 1, 15, 12)).map((s) => [s.name, [s.openUtc, s.closeUtc]]));
    expect(january).toEqual({ Asia: [0, 9], London: [8, 17], 'New York': [13, 22] });
    // Late October 2026: Europe is back on winter time, the US is not yet.
    const gap = Object.fromEntries(sessionHoursUtc(at(2026, 10, 27, 12)).map((s) => [s.name, [s.openUtc, s.closeUtc]]));
    expect(gap).toEqual({ Asia: [0, 9], London: [8, 17], 'New York': [12, 21] });
  });

  it('says which sessions are open', () => {
    expect(sessionsOpenAt(at(2026, 7, 15, 3))).toEqual(['Asia']); // Wednesday
    expect(sessionsOpenAt(at(2026, 7, 15, 8))).toEqual(['Asia', 'London']);
    expect(sessionsOpenAt(at(2026, 7, 15, 13))).toEqual(['London', 'New York']);
    expect(sessionsOpenAt(at(2026, 7, 15, 22))).toEqual([]);
    expect(sessionsOpenAt(at(2026, 7, 18, 13))).toEqual([]); // Saturday
    expect(sessionsOpenAt(at(2026, 7, 19, 23, 30))).toEqual([]); // Sunday 23:30 UTC is Monday 08:30 in Tokyo, before the 09:00 open
    expect(sessionsOpenAt(at(2026, 7, 20, 0, 30))).toEqual(['Asia']); // Monday 09:30 Tokyo
  });

  it('averages the high-low range for each hour of the day', () => {
    const bar = (d: number, h: number, hi: number, lo: number): Bar => ({ time: at(2026, 1, d, h), open: 100, high: hi, low: lo, close: 100 });
    const bars = [bar(5, 8, 101, 99), bar(5, 9, 100.5, 100), bar(6, 8, 102, 98), bar(6, 9, 100.5, 100)];
    const p = hourlyRangeProfile(bars, 30);
    expect(p.averageRangePercent[8]).toBeCloseTo(3, 12); // (2% + 4%) / 2
    expect(p.averageRangePercent[9]).toBeCloseTo(0.5, 12);
    expect(p.averageRangePercent[10]).toBeNull();
    expect(p.counts[8]).toBe(2);
    expect(p.daysCovered).toBe(2);
    // Only the last day when the window is one day.
    expect(hourlyRangeProfile(bars, 1).averageRangePercent[8]).toBeCloseTo(4, 12);
    expect(hourlyRangeProfile([], 30).daysCovered).toBe(0);
  });
});
