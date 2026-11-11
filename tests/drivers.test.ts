import { describe, expect, it } from 'vitest';
import { alignedChanges, driverLink, indexFromMoves, latestMove, levelInRange, linkDirection, type Point } from '../src/calc/drivers';
import { DailyCsvError, parseDailyCsv, parseTreasuryYields } from '../src/data/dailyCsv';

const day = (d: number) => Date.UTC(2026, 0, d) / 1000;
const series = (values: (number | null)[], start = 5): Point[] => values.flatMap((v, i) => (v === null ? [] : [{ time: day(start + i), value: v }]));

describe('gold driver calculations', () => {
  it('measures a price in percent and a yield in percentage points', () => {
    const gold = series([100, 110, 99]);
    const yields = series([4.0, 4.1, 3.9]);
    const { x, y, times } = alignedChanges(gold, 'percent', yields, 'difference');
    expect(x.map((v) => +v.toFixed(6))).toEqual([10, -10]);
    expect(y.map((v) => +v.toFixed(6))).toEqual([0.1, -0.2]);
    expect(times).toEqual([day(6), day(7)]);
  });

  it('pairs changes only across days both series have', () => {
    const gold = series([100, 110, 121, 133.1]);
    const yields = series([4, null, 4.3, 4.2]); // the yield has no value on the second day (a US holiday, say)
    const { x, y } = alignedChanges(gold, 'percent', yields, 'difference');
    expect(x.map((v) => +v.toFixed(6))).toEqual([21, 10]); // 100 -> 121 spans the gap for both
    expect(y.map((v) => +v.toFixed(6))).toEqual([0.3, -0.1]);
  });

  it('gives the link now and one day earlier, and nothing when history is short', () => {
    // Gold changes: +1, +2, -1, +3, -2 (percent). Driver changes: the same numbers in points, so r = 1 ...
    const gold = series([100, 101, 103.02, 101.9898, 105.049494, 102.94850412]);
    const moving = series([4, 4.01, 4.03, 4.02, 4.05, 4.03]);
    const link = driverLink(gold, moving, 'difference', 4);
    expect(link.n).toBe(5);
    expect(link.r).toBeCloseTo(1, 6);
    expect(link.rPrevious).toBeCloseTo(1, 6);
    expect(link.lastTime).toBe(day(10));
    // ... and the mirror image gives -1.
    const opposite = series([4, 3.99, 3.97, 3.98, 3.95, 3.97]);
    expect(driverLink(gold, opposite, 'difference', 4).r).toBeCloseTo(-1, 6);
    const short = driverLink(gold, moving, 'difference', 30);
    expect(short.r).toBeNull();
    expect(short.n).toBe(5);
    // Exactly enough for today but not for yesterday.
    const edge = driverLink(gold, moving, 'difference', 5);
    expect(edge.r).not.toBeNull();
    expect(edge.rPrevious).toBeNull();
  });

  it('names the direction of a link', () => {
    expect(linkDirection(0.4)).toBe('with');
    expect(linkDirection(-0.01)).toBe('against');
    expect(linkDirection(null)).toBe('none');
    expect(linkDirection(0)).toBe('none');
  });

  it('places the latest value within its recent range', () => {
    expect(levelInRange(series([10, 20, 15]))).toBeCloseTo(0.5, 12);
    expect(levelInRange(series([10, 20, 20]))).toBe(1);
    expect(levelInRange(series([10, 20, 10]))).toBe(0);
    expect(levelInRange(series([1, 100, 10, 20, 15]), 3)).toBeCloseTo(0.5, 12); // only the last three count
    expect(levelInRange(series([7, 7, 7]))).toBe(0.5);
    expect(levelInRange(series([7]))).toBeNull();
  });

  it('reports the latest value and its change on the day', () => {
    expect(latestMove(series([4.0, 4.25]), 'difference')).toEqual({ value: 4.25, change: 0.25, time: day(6) });
    expect(latestMove(series([200, 210]), 'percent')!.change).toBeCloseTo(5, 12);
    expect(latestMove(series([1]), 'percent')).toBeNull();
  });

  it('builds an index from daily moves', () => {
    const idx = indexFromMoves([{ time: day(5), percent: 1 }, { time: day(6), percent: -2 }]);
    expect(idx[0]).toEqual({ time: day(5), value: 101 });
    expect(idx[1]!.value).toBeCloseTo(98.98, 10);
  });
});

describe('daily series files', () => {
  // Real rows from the US Treasury daily par yield curve file, as published (10 Nov 2026 download).
  const treasury = [
    'Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"',
    '11/09/2026,4.04,4.13,4.19,4.24,4.20,4.26,4.38,4.56,4.58,4.67,4.76,4.88,5.29,5.26',
    '11/06/2026,4.02,4.07,4.15,4.19,4.19,4.23,4.33,4.51,4.59,4.64,4.74,4.86,5.29,5.26',
    '11/05/2026,4.03,4.07,4.15,4.17,4.16,4.19,4.28,4.46,4.53,4.59,4.70,4.84,5.27,5.25',
  ].join('\n');

  it('reads the 10-year column of the Treasury file, oldest first', () => {
    const r = parseTreasuryYields(treasury);
    expect(r.column).toBe('10 Yr');
    expect(r.points).toEqual([
      { time: Date.UTC(2026, 10, 5) / 1000, value: 4.84 },
      { time: Date.UTC(2026, 10, 6) / 1000, value: 4.86 },
      { time: Date.UTC(2026, 10, 9) / 1000, value: 4.88 },
    ]);
  });

  it('rejects a Treasury file without the 10-year column', () => {
    expect(() => parseTreasuryYields('Date,"1 Mo"\n11/09/2026,4.04')).toThrow(DailyCsvError);
  });

  it('reads an index history with open, high, low and close, taking the close', () => {
    // Layout of the Cboe VIX history file. The numbers are made up for the test.
    const r = parseDailyCsv('DATE,OPEN,HIGH,LOW,CLOSE\n01/05/2026,20,22,19,21\n01/06/2026,21,25,20,24');
    expect(r.column).toBe('CLOSE');
    expect(r.points.map((p) => p.value)).toEqual([21, 24]);
    expect(r.points[0]!.time).toBe(day(5));
  });

  it('reads ISO dates and day-first dates, deciding the order from the whole column', () => {
    expect(parseDailyCsv('date,value\n2026-01-05,1.5\n2026-01-06,1.6').points[1]).toEqual({ time: day(6), value: 1.6 });
    // 13/01 can only be day-first, so 05/01 is 5 January too.
    const dmy = parseDailyCsv('date,close\n05/01/2026,10\n13/01/2026,11');
    expect(dmy.points.map((p) => p.time)).toEqual([day(5), day(13)]);
    // With nothing above 12, the US order is assumed: 01/05 is 5 January.
    expect(parseDailyCsv('date,close\n01/05/2026,10\n01/06/2026,11').points[0]!.time).toBe(day(5));
  });

  it('skips rows with a missing value instead of filling them', () => {
    const r = parseDailyCsv('date,close\n2026-01-05,10\n2026-01-06,\n2026-01-07,n/a\n2026-01-08,12');
    expect(r.points.map((p) => p.value)).toEqual([10, 12]);
    expect(r.skipped).toBe(2);
  });

  it('explains what is wrong with an unusable file', () => {
    expect(() => parseDailyCsv('')).toThrow(/no data rows/);
    expect(() => parseDailyCsv('2026-01-05,10\n2026-01-06,11')).toThrow(/header row/);
    expect(() => parseDailyCsv('date,close\nhello,world')).toThrow(/No rows/);
  });
});
