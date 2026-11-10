import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FileImportAdapter } from '../src/data/fileAdapter';
import { INSTRUMENTS } from '../src/data/instruments';
import { loadSamples, type SampleManifest } from '../src/data/samples';
import type { ImportResult } from '../src/data/fileAdapter';

const publicDir = join(__dirname, '..', 'public');
const readText = (path: string) => readFile(join(publicDir, path), 'utf8');
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

describe('shipped sample files', () => {
  const adapter = new FileImportAdapter();
  let manifest: SampleManifest;
  let results: ImportResult[];

  beforeAll(async () => {
    ({ manifest, results } = await loadSamples(adapter, readText));
  });

  it('load for gold and all 28 pairs with no rows skipped', () => {
    expect(results).toHaveLength(29);
    expect(new Set(adapter.capabilities().instruments)).toEqual(new Set(INSTRUMENTS));
    for (const { parsed, series } of results) {
      expect(parsed.format, series.instrument).toBe('mt5');
      expect(parsed.skipped, series.instrument).toEqual([]);
      expect(parsed.duplicates, series.instrument).toBe(0);
      expect(parsed.timeframe, series.instrument).toBe('D1');
      expect(series.bars.length, series.instrument).toBeGreaterThan(200);
    }
  });

  it('are labelled as daily reference rates, not live or intraday prices', () => {
    expect(manifest.closeOnly).toBe(true);
    for (const { series } of results) {
      expect(series.source.closeOnly).toBe(true);
      expect(series.source.freshness).toBe('file');
      expect(series.source.label).toMatch(/^Sample: /);
      expect(series.source.asOf).toBe(series.bars[series.bars.length - 1]!.time);
      expect(series.bars.every((b) => b.open === b.close && b.high === b.low)).toBe(true);
    }
  });

  it('contain no weekend bars', () => {
    for (const { series } of results) {
      const weekend = series.bars.filter((b) => [0, 6].includes(new Date(b.time * 1000).getUTCDay()));
      expect(weekend, series.instrument).toEqual([]);
    }
  });

  it('match values checked by hand against the source', async () => {
    // Frankfurter /v2/rates?base=XAU&quotes=USD, read on 10 Nov 2026.
    const gold = await adapter.getBars({ instrument: 'XAUUSD', timeframe: 'D1' });
    const byTime = new Map(gold!.bars.map((b) => [b.time, b.close]));
    expect(byTime.get(utc(2026, 11, 9))).toBe(4082.89);
    expect(byTime.get(utc(2026, 11, 6))).toBe(4089.58);
    expect(byTime.get(utc(2026, 10, 30))).toBe(4008.09);
    // Frankfurter /v2/rates?base=EUR&quotes=USD,JPY, read on 10 Nov 2026.
    const eurusd = await adapter.getBars({ instrument: 'EURUSD', timeframe: 'D1', from: utc(2026, 11, 9), to: utc(2026, 11, 9) });
    expect(eurusd!.bars).toHaveLength(1);
    expect(eurusd!.bars[0]!.close).toBe(1.1184);
    const eurjpy = await adapter.getBars({ instrument: 'EURJPY', timeframe: 'D1', from: utc(2026, 11, 6), to: utc(2026, 11, 6) });
    expect(eurjpy!.bars[0]!.close).toBe(177.35);
  });

  it('can be cut off at a past time, which is what replay will do', async () => {
    const cut = utc(2026, 6, 30);
    const series = await adapter.getBars({ instrument: 'XAUUSD', timeframe: 'D1', to: cut });
    expect(series!.bars[series!.bars.length - 1]!.time).toBeLessThanOrEqual(cut);
    expect(series!.source.asOf).toBe(series!.bars[series!.bars.length - 1]!.time);
  });

  it('return null, not invented data, when nothing is loaded for a request', async () => {
    expect(await adapter.getBars({ instrument: 'XAUUSD', timeframe: 'H1' })).toBeNull();
    expect(await adapter.getBars({ instrument: 'XAUUSD', timeframe: 'D1', from: utc(2030, 1, 1) })).toBeNull();
  });
});

describe('FileImportAdapter', () => {
  it('needs an instrument and timeframe from the name, the options or the data', () => {
    const a = new FileImportAdapter();
    const row = '2026.01.05,00:00,1,2,1,2,0';
    expect(() => a.importText('prices.csv', row)).toThrow(/which instrument/);
    expect(() => a.importText('EURUSD.csv', row)).toThrow(/timeframe/);
    const r = a.importText('EURUSD60.csv', row, { now: () => 1000 });
    expect(r.series).toMatchObject({ instrument: 'EURUSD', timeframe: 'H1' });
    expect(r.series.source).toEqual({ adapter: 'file', label: 'File: EURUSD60.csv', freshness: 'file', asOf: Date.UTC(2026, 0, 5) / 1000, retrievedAt: 1000 });
  });
});
