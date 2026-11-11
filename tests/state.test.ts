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
    expect(parseSettings(JSON.stringify(saved))).toMatchObject(saved);
    expect(parseSettings('{"importZone":"ny-close"}').importZone).toBe('ny-close');
  });

  it('keeps valid calculation settings and rejects impossible ones', () => {
    const good = { strengthLookbackHours: 168, atrPeriod: 10, volatilityBaselineDays: 30, sessionProfileDays: 60, correlationWindow: 100, correlationThreshold: 0.7, watchlist: ['XAUUSD', 'EURUSD', 'GBPJPY'] };
    expect(parseSettings(JSON.stringify(good))).toMatchObject(good);
    const bad = { strengthLookbackHours: 0, atrPeriod: 1.5, volatilityBaselineDays: -3, sessionProfileDays: 'x', correlationWindow: 2, correlationThreshold: 1.2, watchlist: ['XAUUSD', 'NOPE'] };
    expect(parseSettings(JSON.stringify(bad))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"watchlist":["EURUSD","EURUSD","USDJPY","BTCUSD"]}').watchlist).toEqual(['EURUSD', 'USDJPY']);
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

import { AppState } from '../src/app/state';
import { defaultLayout } from '../src/app/layout';

describe('changing settings', () => {
  it('refuses values outside their range and keeps the default instead', () => {
    const state = new AppState();
    state.update({ atrPeriod: 21, correlationThreshold: 0.7 });
    expect(state.settings).toMatchObject({ atrPeriod: 21, correlationThreshold: 0.7 });
    state.update({ atrPeriod: -5, correlationThreshold: 4, watchlist: ['XAUUSD'] });
    expect(state.settings.atrPeriod).toBe(DEFAULT_SETTINGS.atrPeriod);
    expect(state.settings.correlationThreshold).toBe(DEFAULT_SETTINGS.correlationThreshold);
    expect(state.settings.watchlist).toEqual(DEFAULT_SETTINGS.watchlist);
  });

  it('resets settings but keeps what is being looked at', () => {
    const state = new AppState();
    state.update({ instrument: 'GBPJPY', timeframe: 'H4', driverWindow: 60, liveGold: false, displayZone: 'utc' });
    let told = 0;
    state.onSettings(() => told++);
    state.resetSettings();
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, instrument: 'GBPJPY', timeframe: 'H4' });
    expect(told).toBe(1);
  });

  it('restores the starting layout', () => {
    const state = new AppState();
    state.setLayout({ root: null, nextId: 9 });
    state.resetLayout();
    expect(state.layout).toEqual(defaultLayout());
  });
});
