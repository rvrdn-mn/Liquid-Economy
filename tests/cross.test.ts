import { describe, expect, it } from 'vitest';
import { strengthView } from '../src/app/analysis';
import { crossLegs, deriveCrossBars, getDerivedCross, usdLeg } from '../src/data/cross';
import { FileImportAdapter } from '../src/data/fileAdapter';
import { FX_PAIRS } from '../src/data/instruments';
import type { Bar, BarRequest } from '../src/data/types';

// Made-up round numbers, used only to check the arithmetic.
const t0 = Date.UTC(2026, 0, 5) / 1000;
const bar = (i: number, close: number): Bar => ({ time: t0 + i * 3600, open: close, high: close + 1, low: close - 1, close });

describe('cross rates from the dollar pairs', () => {
  it('knows which dollar pair prices each currency', () => {
    expect(usdLeg('EUR')).toEqual({ instrument: 'EURUSD', invert: false });
    expect(usdLeg('JPY')).toEqual({ instrument: 'USDJPY', invert: true });
    expect(usdLeg('USD')).toBeNull();
    expect(crossLegs('EURGBP')).toEqual({ base: { instrument: 'EURUSD', invert: false }, quote: { instrument: 'GBPUSD', invert: false } });
    expect(crossLegs('EURUSD')).toBeNull(); // already a dollar pair
    expect(crossLegs('XAUUSD')).toBeNull();
    expect(FX_PAIRS.filter((p) => crossLegs(p) !== null)).toHaveLength(21);
  });

  it('divides or multiplies the legs as the quoting requires', () => {
    // EURGBP = EURUSD / GBPUSD
    expect(deriveCrossBars([bar(0, 1.2)], usdLeg('EUR')!, [bar(0, 1.5)], usdLeg('GBP')!)[0]!.close).toBeCloseTo(0.8, 12);
    // EURJPY = EURUSD * USDJPY
    expect(deriveCrossBars([bar(0, 1.2)], usdLeg('EUR')!, [bar(0, 150)], usdLeg('JPY')!)[0]!.close).toBeCloseTo(180, 12);
    // CADJPY = USDJPY / USDCAD
    expect(deriveCrossBars([bar(0, 1.25)], usdLeg('CAD')!, [bar(0, 150)], usdLeg('JPY')!)[0]!.close).toBeCloseTo(120, 12);
  });

  it('uses only timestamps both legs have and gives close-only bars', () => {
    const eur = [bar(0, 1.2), bar(1, 1.21), bar(3, 1.22)];
    const gbp = [bar(1, 1.5), bar(2, 1.5), bar(3, 1.6)];
    const out = deriveCrossBars(eur, usdLeg('EUR')!, gbp, usdLeg('GBP')!);
    expect(out.map((b) => b.time)).toEqual([t0 + 3600, t0 + 3 * 3600]);
    expect(out.every((b) => b.open === b.close && b.high === b.close && b.low === b.close)).toBe(true);
  });

  const rows = (closes: number[]) => closes.map((c, i) => `2026.01.05,${String(i).padStart(2, '0')}:00,${c},${c},${c},${c},0`).join('\n');

  it('is served, labelled as derived, when both leg files are loaded', async () => {
    const a = new FileImportAdapter();
    a.importText('EURUSD_H1.csv', rows([1.2, 1.26]));
    a.importText('GBPUSD_H1.csv', rows([1.5, 1.5]));
    const req: BarRequest = { instrument: 'EURGBP', timeframe: 'H1' };
    const s = await getDerivedCross(a, req);
    expect(s!.bars.map((b) => +b.close.toFixed(6))).toEqual([0.8, 0.84]);
    expect(s!.source.label).toBe('Derived from EURUSD and GBPUSD files');
    expect(s!.source.closeOnly).toBe(true);
    expect(await getDerivedCross(a, { instrument: 'EURJPY', timeframe: 'H1' })).toBeNull(); // no USDJPY file
    expect(await getDerivedCross(a, { instrument: 'EURUSD', timeframe: 'H1' })).toBeNull(); // not a cross
    // A replay cut reaches the legs.
    const cut = await getDerivedCross(a, { ...req, to: t0 });
    expect(cut!.bars).toHaveLength(1);
  });

  it('lets the strength board use all 28 pairs from seven dollar-pair files', async () => {
    const files = new FileImportAdapter();
    // Hour 0 to hour 1: EUR +1% against the dollar, everything else flat.
    const flat: Record<string, number> = { GBPUSD: 1.5, AUDUSD: 0.7, NZDUSD: 0.6, USDCAD: 1.25, USDCHF: 0.8, USDJPY: 150 };
    files.importText('EURUSD_H1.csv', rows([1.2, 1.212]));
    for (const [pair, price] of Object.entries(flat)) files.importText(`${pair}_H1.csv`, rows([price, price]));
    const source = { getBars: async (req: BarRequest) => (await files.getBars(req)) ?? (await getDerivedCross(files, req)) };
    const v = await strengthView(source, 'H1', 1);
    expect(v.loaded.missing).toEqual([]);
    expect(Object.values(v.now!.pairsUsed)).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
    // EUR gained 1% against all seven. Each other currency lost about 1% to EUR and was flat against the rest: -0.99/7.
    expect(v.now!.average.EUR).toBeCloseTo(1, 9);
    expect(v.now!.average.USD).toBeCloseTo(-1 / 7, 9);
    expect(v.now!.average.JPY).toBeCloseTo(-1 / 7, 9);
    expect(v.now!.ranked[0]).toBe('EUR');
    expect([...v.loaded.sources].sort()).toEqual(['Crosses derived from imported files', 'Imported files']);
  });
});
