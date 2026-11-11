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
import { leaves } from '../src/app/layout';
import { parseWorkspaces } from '../src/app/state';
import { defaultWorkspaceLayout, homeWorkspace, WORKSPACE_IDS, WORKSPACES } from '../src/app/workspaces';

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

  it('keeps a separate arrangement for each page', () => {
    const state = new AppState();
    expect(state.workspace).toBe('overview');
    state.setLayout({ root: null, nextId: 9 });
    state.setWorkspace('gold');
    expect(leaves(state.layout.root).map((l) => l.panel)).toEqual(['LIQ', 'DRV']);
    state.setWorkspace('overview');
    expect(state.layout.root).toBeNull(); // the change to Overview was kept
    state.resetLayout();
    expect(state.layout).toEqual(defaultWorkspaceLayout('overview'));
  });

  it('tells listeners when the page changes, once', () => {
    const state = new AppState();
    let told = 0;
    state.onLayout(() => told++);
    state.setWorkspace('news');
    state.setWorkspace('news');
    expect(told).toBe(1);
    state.resetAllLayouts();
    expect(told).toBe(2);
  });
});

describe('workspaces', () => {
  const panels = (id: (typeof WORKSPACE_IDS)[number]) => leaves(defaultWorkspaceLayout(id).root).map((l) => l.panel);

  it('gives every page a name, a summary and a valid starting arrangement', () => {
    for (const id of WORKSPACE_IDS) {
      expect(WORKSPACES[id].name.length, id).toBeGreaterThan(2);
      const layout = defaultWorkspaceLayout(id);
      const ids = leaves(layout.root).map((l) => l.id);
      expect(new Set(ids).size, id).toBe(ids.length);
      expect(layout.nextId, id).toBe(ids.length + 1);
    }
  });

  it('opens on a calm first page: the chart, the weather map and the strength board', () => {
    expect(panels('overview')).toEqual(['CHART', 'WX', 'STR']);
    expect(panels('currencies')).toEqual(['WX', 'VOL', 'LINK', 'STR', 'SES']);
    expect(panels('gold')).toEqual(['LIQ', 'DRV']);
    expect(panels('journal')).toEqual(['JRN', 'CHART']);
  });

  it('knows which page a panel belongs to', () => {
    expect(homeWorkspace('LIQ')).toBe('gold');
    expect(homeWorkspace('WX')).toBe('currencies');
    expect(homeWorkspace('CHART')).toBe('journal');
    expect(homeWorkspace('SET')).toBe('settings');
    expect(homeWorkspace('NEWS')).toBe('news');
    expect(homeWorkspace('CAL')).toBeNull(); // not on any page
  });

  it('falls back page by page when saved arrangements are damaged', () => {
    const good = defaultWorkspaceLayout('gold');
    const saved = parseWorkspaces(JSON.stringify({ current: 'gold', layouts: { gold: { root: null, nextId: 5 }, news: { root: { type: 'leaf', id: 'p1', panel: 'NOPE' }, nextId: 2 } } }));
    expect(saved.current).toBe('gold');
    expect(saved.layouts.gold).toEqual({ root: null, nextId: 5 }); // a valid change is kept
    expect(saved.layouts.news).toEqual(defaultWorkspaceLayout('news')); // a damaged one is replaced
    expect(saved.layouts.overview).toEqual(defaultWorkspaceLayout('overview'));
    expect(parseWorkspaces('garbage').layouts.gold).toEqual(good);
    expect(parseWorkspaces(JSON.stringify({ current: 'moon' })).current).toBe('overview');
  });
});
