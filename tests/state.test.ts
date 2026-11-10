import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../src/app/state';
import { isEuropeanSummerTime, wallClockToUtc } from '../src/data/fileZone';

describe('parseSettings', () => {
  it('falls back to defaults for missing or damaged data', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"instrument":"BTCUSD","timeframe":"W1","displayZone":"mars","dayRoll":3,"importZone":"moon"}')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid saved values', () => {
    const saved = { instrument: 'EURJPY', timeframe: 'H4', displayZone: 'utc', dayRoll: 'utc', importZone: 120 };
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved);
    expect(parseSettings('{"importZone":"ny-close"}').importZone).toBe('ny-close');
  });
});

describe('file clocks', () => {
  const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;

  it('knows European summer time for 2026 (29 March to 25 October)', () => {
    expect(isEuropeanSummerTime(at(2026, 3, 29, 0))).toBe(false);
    expect(isEuropeanSummerTime(at(2026, 3, 29, 1))).toBe(true);
    expect(isEuropeanSummerTime(at(2026, 10, 25, 0))).toBe(true);
    expect(isEuropeanSummerTime(at(2026, 10, 25, 1))).toBe(false);
  });

  it('converts fixed offsets both ways round', () => {
    expect(wallClockToUtc(at(2026, 1, 5, 2), 120)).toBe(at(2026, 1, 5, 0));
    expect(wallClockToUtc(at(2026, 1, 5, 19), -300)).toBe(at(2026, 1, 6, 0));
    expect(wallClockToUtc(at(2026, 1, 5, 7), 0)).toBe(at(2026, 1, 5, 7));
  });
});
