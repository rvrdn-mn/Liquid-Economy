import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { driversView, linksView, loadMany, sessionView, strengthView, volatilityView, weatherView, type DriverSource } from '../src/app/analysis';
import { parseDailyCsv } from '../src/data/dailyCsv';
import type { DailySeries } from '../src/data/types';
import { DEFAULT_SETTINGS } from '../src/app/state';
import { FileImportAdapter } from '../src/data/fileAdapter';
import { FX_PAIRS, INSTRUMENTS } from '../src/data/instruments';
import { loadSamples } from '../src/data/samples';

const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;

/**
 * Expected values below were computed separately from the app, by a short
 * script reading the sample CSV files directly (10 Nov 2026). They are the
 * "hand-checked values on the sample data" of the phase 2 finish line.
 */
describe('panels on the shipped sample data', () => {
  const samples = new FileImportAdapter();
  beforeAll(async () => {
    await loadSamples(samples, (path) => readFile(join(__dirname, '..', 'public', path), 'utf8'));
  });

  it('strength board, 24-hour lookback: Friday 6 Nov to Monday 9 Nov', async () => {
    const v = await strengthView(samples, 'D1', 24);
    expect(v.loaded.asOf).toBe(at(2026, 11, 10)); // end of the 9 Nov bar
    expect(v.loaded.missing).toEqual([]);
    expect(v.now!.ranked).toEqual(['NZD', 'USD', 'JPY', 'GBP', 'CHF', 'EUR', 'CAD', 'AUD']);
    const expected = { NZD: [0.283833, 100], USD: [0.2469, 95.0286], JPY: [0.229583, 92.6976], GBP: [0.03451, 66.4394], CHF: [0.027272, 65.4651], EUR: [-0.03567, 56.9925], CAD: [-0.327359, 17.7291], AUD: [-0.459069, 0] } as const;
    for (const [ccy, [average, score]] of Object.entries(expected)) {
      expect(v.now!.average[ccy as keyof typeof expected], ccy).toBeCloseTo(average, 5);
      expect(v.now!.score[ccy as keyof typeof expected], ccy).toBeCloseTo(score, 3);
      expect(v.now!.pairsUsed[ccy as keyof typeof expected]).toBe(7);
    }
    expect(v.spotlight).toEqual({ pair: 'AUDNZD', strong: 'NZD', weak: 'AUD' });
  });

  it('strength board, one-week lookback: Monday 2 Nov to Monday 9 Nov', async () => {
    const v = await strengthView(samples, 'D1', 168);
    expect(v.now!.ranked).toEqual(['CHF', 'GBP', 'USD', 'EUR', 'JPY', 'CAD', 'NZD', 'AUD']);
    expect(v.now!.average.CHF).toBeCloseTo(0.934892, 5);
    expect(v.now!.score.GBP).toBeCloseTo(84.126, 3);
    expect(v.now!.score.NZD).toBeCloseTo(44.7822, 3);
    expect(v.spotlight!.pair).toBe('AUDCHF');
  });

  it('strength history ends at the current reading', async () => {
    const v = await strengthView(samples, 'D1', 24, 30);
    expect(v.historyTimes).toHaveLength(30);
    expect(v.historyTimes[29]).toBe(v.loaded.asOf);
    expect(v.history.NZD[29]).toBe(100);
    expect(v.history.AUD[29]).toBe(0);
    expect(v.history.USD[29]).toBeCloseTo(95.0286, 3);
    expect(v.history.USD.every((x) => x !== null && x >= 0 && x <= 100)).toBe(true);
  });

  it('strength says why when it cannot be computed', async () => {
    expect((await strengthView(samples, 'D1', 4)).reason).toMatch(/shorter than one D1 bar/);
    expect((await strengthView(samples, 'H1', 24)).reason).toMatch(/No H1 data/);
    expect((await strengthView(samples, 'D1', 24 * 400)).reason).toMatch(/does not reach back/);
  });

  it('volatility: current against the 20-day average', async () => {
    const v = await volatilityView(samples, INSTRUMENTS, 'D1', 14, 20);
    expect(v.rows).toHaveLength(29);
    const row = (id: string) => v.rows.find((r) => r.instrument === id)!;
    expect(row('XAUUSD').reading.current).toBeCloseTo(0.81953504, 7);
    expect(row('XAUUSD').reading.baseline).toBeCloseTo(0.58230051, 7);
    expect(row('XAUUSD').reading.ratio).toBeCloseTo(1.4074091, 6);
    expect(row('XAUUSD').reading.baselineBars).toBe(14);
    expect(row('EURUSD').reading.ratio).toBeCloseTo(1.37775403, 6);
    expect(row('USDJPY').reading.ratio).toBeCloseTo(1.1209887, 6);
    expect(row('XAUUSD').closeOnly).toBe(true);
    // Sorted so the most unusually active come first.
    const ratios = v.rows.map((r) => r.reading.ratio);
    expect([...ratios].sort((a, b) => b - a)).toEqual(ratios);
  });

  it('linked pairs: 50-bar correlation of daily returns', async () => {
    const s = DEFAULT_SETTINGS;
    const v = await linksView(samples, s.watchlist, 'D1', s.correlationWindow, s.correlationThreshold);
    const r = (a: string, b: string) => v.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))!.r;
    expect(v.links).toHaveLength(28); // 8 instruments, every pairing once
    expect(r('EURUSD', 'GBPUSD')).toBeCloseTo(0.78744254, 7);
    expect(r('EURUSD', 'USDCHF')).toBeCloseTo(-0.53833247, 7);
    expect(r('XAUUSD', 'EURUSD')).toBeCloseTo(0.32539623, 7);
    expect(r('AUDUSD', 'NZDUSD')).toBeCloseTo(0.54145165, 7);
    expect(r('XAUUSD', 'USDJPY')).toBeCloseTo(-0.03374786, 7);
    expect(v.flagged.every((l) => Math.abs(l.r!) > 0.8)).toBe(true);
    expect(r('EURUSD', 'GBPUSD')! > 0.8).toBe(false); // 0.787 is close, but not flagged
  });

  it('weather map: pressure, wind over six bars, and storm per currency', async () => {
    const v = await weatherView(samples, 'D1', 24, 14, 20);
    const by = Object.fromEntries(v.currencies.map((c) => [c.currency, c]));
    expect(v.currencies.map((c) => c.currency)).toEqual(['NZD', 'USD', 'JPY', 'GBP', 'CHF', 'EUR', 'CAD', 'AUD']);
    expect(by.USD!.pressure).toBeCloseTo(95.0286, 3); // the strength board's number
    const wind = { USD: 80.722, EUR: 20.827, GBP: -8.5157, JPY: 42.9828, CHF: -34.5349, AUD: 0, CAD: -24.4701, NZD: 55.5041 };
    const storm = { USD: 1.1672, EUR: 1.101777, GBP: 1.144452, JPY: 1.149087, CHF: 1.064084, AUD: 1.183273, CAD: 1.096885, NZD: 1.277272 };
    for (const c of Object.keys(wind) as (keyof typeof wind)[]) {
      expect(by[c]!.wind, `${c} wind`).toBeCloseTo(wind[c], 3);
      expect(by[c]!.storm, `${c} storm`).toBeCloseTo(storm[c], 5);
    }
    expect(by.NZD!.level).toBe('breezy');
    expect(by.CHF!.level).toBe('calm');
    expect(v.volatilityPairs).toBe(28);
  });

  describe('gold drivers', () => {
    let yields: DailySeries;
    beforeAll(async () => {
      const { points } = parseDailyCsv(await readFile(join(__dirname, '..', 'public', 'samples', 'drivers', 'us10y.csv'), 'utf8'));
      yields = { id: 'yield', label: 'US 10-year Treasury yield', points, source: { adapter: 'sample', label: 'saved copy', freshness: 'file', asOf: points[points.length - 1]!.time, retrievedAt: 0 } };
    });
    /** The sample data as it would be seen at a replay moment (or now, with none). */
    const source = (asOf?: number): DriverSource => ({
      getBars: (req) => samples.getBars(asOf === undefined ? req : { ...req, asOf }),
      getDailySeries: async (id) => {
        if (id !== 'yield') return null;
        if (asOf === undefined) return yields;
        return { ...yields, points: yields.points.filter((p) => p.time + 86400 <= asOf), source: { ...yields.source, replayAt: asOf } };
      },
    });

    it('30-day links of the dollar and the 10-year yield with gold', async () => {
      const v = await driversView(source(), 30);
      const [dollar, yld, risk] = v.rows;
      expect(dollar!.link!.r).toBeCloseTo(-0.05441, 5);
      expect(dollar!.link!.rPrevious).toBeCloseTo(-0.047296, 5);
      expect(dollar!.link!.n).toBe(264);
      expect(dollar!.direction).toBe('against');
      expect(dollar!.latest!.value).toBeCloseTo(100.367734, 5);
      expect(dollar!.latest!.change).toBeCloseTo(0.2469, 4); // the strength board's dollar move for the day
      expect(dollar!.level).toBeCloseTo(0.608872, 5);
      expect(yld!.link!.r).toBeCloseTo(-0.133681, 5);
      expect(yld!.link!.rPrevious).toBeCloseTo(-0.134189, 5);
      expect(yld!.link!.n).toBe(254);
      // The yield file runs a day past the gold sample (4.98 on 10 Nov); that day is held back.
      expect(yld!.latest!.value).toBe(4.88);
      expect(yld!.latest!.change).toBeCloseTo(0.02, 9);
      expect(yld!.level).toBeCloseTo(0.085106, 5);
      expect(risk).toMatchObject({ available: false, direction: 'none', link: null });
      expect(risk!.reason).toMatch(/Import a daily/);
      expect(v.gold!.level).toBeCloseTo(0.631071, 5);
      expect(v.gold!.closeOnly).toBe(true);
      expect(v.replay).toBe(false);
    });

    it('the links change as replay moves through time', async () => {
      const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;
      // End of 14 August 2026 and end of 20 March 2026.
      const august = await driversView(source(at(2026, 8, 15)), 30);
      expect(august.replay).toBe(true);
      expect(august.rows[0]!.link!.r).toBeCloseTo(-0.008066, 5);
      expect(august.rows[1]!.link!.r).toBeCloseTo(0.15449, 5);
      expect(august.rows[1]!.direction).toBe('with');
      const march = await driversView(source(at(2026, 3, 21)), 30);
      expect(march.rows[0]!.link!.r).toBeCloseTo(-0.286218, 5);
      expect(march.rows[1]!.link!.r).toBeCloseTo(-0.20797, 5);
      expect(march.rows[1]!.link!.rPrevious).toBeCloseTo(0.013034, 5);
      expect(march.rows[1]!.direction).toBe('against');
    });

    it('says so when history is too short for the window', async () => {
      const at = Date.UTC(2025, 10, 20) / 1000; // 13 trading days into the sample
      const early = await driversView(source(at), 30);
      expect(early.rows[0]!.link!.r).toBeNull();
      expect(early.rows[0]!.link!.n).toBeLessThan(30);
      expect(early.rows[0]!.direction).toBe('none');
    });
  });

  it('session profile refuses data that has no range', async () => {
    const v = await sessionView(samples, 'EURUSD', 30);
    expect(v.profile).toBeNull();
    expect(v.reason).toMatch(/No hourly data/);
  });
});

describe('one shared "as of" time', () => {
  const day = (d: number, close: number) => `2026.01.${String(d).padStart(2, '0')},00:00,${close},${close},${close},${close},0`;

  it('is the earliest end among the instruments, and says who limits it', async () => {
    const a = new FileImportAdapter();
    a.importText('EURUSD_D1.csv', [day(5, 1), day(6, 1.01), day(7, 1.02), day(8, 1.03)].join('\n'));
    a.importText('USDJPY_D1.csv', [day(5, 100), day(6, 101)].join('\n'));
    const loaded = await loadMany(a, ['EURUSD', 'USDJPY', 'GBPUSD'], 'D1');
    expect(loaded.asOf).toBe(at(2026, 1, 7)); // end of USDJPY's last bar, 6 Jan
    expect(loaded.limitedBy).toBe('USDJPY');
    expect(loaded.missing).toEqual(['GBPUSD']);
    expect(loaded.sources).toEqual(['Imported files']);
  });

  it('keeps later bars of other instruments out of the comparison', async () => {
    const a = new FileImportAdapter();
    a.importText('EURUSD_D1.csv', [day(5, 1), day(6, 1.01), day(7, 2), day(8, 3)].join('\n'));
    a.importText('USDJPY_D1.csv', [day(5, 100), day(6, 101)].join('\n'));
    const v = await strengthView(a, 'D1', 24);
    // Both measured 5 Jan -> 6 Jan: EURUSD +1%, USDJPY +1%. EUR +1, USD 0, JPY -1.
    expect(v.now!.average.EUR).toBeCloseTo(1, 9);
    expect(v.now!.average.USD).toBeCloseTo(0, 9);
    expect(v.now!.average.JPY).toBeCloseTo(-1, 9);
    expect(v.loaded.limitedBy).toBe('USDJPY');
    expect(v.now!.pairsUsed.GBP).toBe(0);
  });

  it('has no single limiter when everything ends together', async () => {
    const a = new FileImportAdapter();
    a.importText('EURUSD_D1.csv', [day(5, 1), day(6, 1.01)].join('\n'));
    a.importText('USDJPY_D1.csv', [day(5, 100), day(6, 101)].join('\n'));
    expect((await loadMany(a, ['EURUSD', 'USDJPY'], 'D1')).limitedBy).toBeNull();
    expect((await loadMany(a, FX_PAIRS, 'H1')).asOf).toBeNull();
  });
});
