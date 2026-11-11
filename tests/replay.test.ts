import { describe, expect, it } from 'vitest';
import { linksView, loadMany, strengthView } from '../src/app/analysis';
import { clampReplay, snapToStep, stepReplay } from '../src/app/replay';
import { countUpTo } from '../src/data/aggregate';
import { getDerivedCross } from '../src/data/cross';
import { FileImportAdapter } from '../src/data/fileAdapter';
import type { Bar, BarRequest } from '../src/data/types';

// Made-up round numbers, used only to check that replay never sees the future.

const t0 = Date.UTC(2026, 0, 5, 10, 0) / 1000; // Monday 10:00 UTC
const minuteRows = (n: number, price: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date((t0 + i * 60) * 1000);
    const p = price(i);
    return `2026.01.05,${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')},${p},${p + 0.5},${p - 0.5},${p},1`;
  }).join('\n');

describe('countUpTo', () => {
  const bars = [10, 20, 30].map((time): Bar => ({ time, open: 1, high: 1, low: 1, close: 1 }));
  it('counts bars at or before a limit', () => {
    expect(countUpTo(bars, 5)).toBe(0);
    expect(countUpTo(bars, 10)).toBe(1);
    expect(countUpTo(bars, 25)).toBe(2);
    expect(countUpTo(bars, 99)).toBe(3);
    expect(countUpTo(bars, 25, (b) => b.time + 10)).toBe(1); // by bar end
  });
});

describe('replay cut-off in the file adapter', () => {
  const load = () => {
    const a = new FileImportAdapter();
    a.dayRoll = 'utc';
    a.importText('XAUUSD_M1.csv', minuteRows(180, (i) => 100 + i), { now: () => 0 });
    return a;
  };

  it('ends with a part-formed bar that holds nothing after the replay moment', async () => {
    const a = load();
    // 11:30: minute bars 10:00 .. 11:29 have finished (90 of them).
    const s = await a.getBars({ instrument: 'XAUUSD', timeframe: 'H1', asOf: t0 + 90 * 60 });
    expect(s!.bars).toEqual([
      { time: t0, open: 100, high: 159.5, low: 99.5, close: 159, volume: 60 },
      { time: t0 + 3600, open: 160, high: 189.5, low: 159.5, close: 189, volume: 30 },
    ]);
    expect(s!.source.asOf).toBe(t0 + 89 * 60);
    expect(s!.source.replayAt).toBe(t0 + 90 * 60);
    expect(s!.source.label).toMatch(/built from M1 bars/);
  });

  it('matches the full series once the replay moment passes the end', async () => {
    const a = load();
    const whole = await a.getBars({ instrument: 'XAUUSD', timeframe: 'M15' });
    const late = await a.getBars({ instrument: 'XAUUSD', timeframe: 'M15', asOf: t0 + 10 * 86400 });
    expect(late!.bars).toEqual(whole!.bars);
  });

  it('grows one fine bar at a time and never changes what it already showed', async () => {
    const a = load();
    let previous: Bar[] = [];
    for (let minute = 1; minute <= 180; minute += 7) {
      const s = await a.getBars({ instrument: 'XAUUSD', timeframe: 'M5', asOf: t0 + minute * 60 });
      const bars = s!.bars;
      expect(bars[bars.length - 1]!.close).toBe(100 + minute - 1); // the last finished minute
      // Every bar shown earlier, except the then part-formed last one, is unchanged.
      expect(bars.slice(0, Math.max(0, previous.length - 1))).toEqual(previous.slice(0, -1));
      previous = bars;
    }
  });

  it('returns nothing before the first bar has finished', async () => {
    const a = load();
    expect(await a.getBars({ instrument: 'XAUUSD', timeframe: 'H1', asOf: t0 + 30 })).toBeNull();
    expect(await a.getBars({ instrument: 'XAUUSD', timeframe: 'H1', asOf: t0 - 3600 })).toBeNull();
  });

  it('for a file with no finer source, shows only bars that had finished', async () => {
    const a = new FileImportAdapter();
    const day = (d: number, c: number) => `2026.01.${String(d).padStart(2, '0')},00:00,${c},${c},${c},${c},0`;
    a.importText('EURUSD_D1.csv', [day(5, 1), day(6, 2), day(7, 3)].join('\n'));
    const at = (d: number, h = 0) => Date.UTC(2026, 0, d, h) / 1000;
    // Noon on the 6th: the 6th's daily close is not known yet.
    expect((await a.getBars({ instrument: 'EURUSD', timeframe: 'D1', asOf: at(6, 12) }))!.bars.map((b) => b.close)).toEqual([1]);
    expect((await a.getBars({ instrument: 'EURUSD', timeframe: 'D1', asOf: at(7) }))!.bars.map((b) => b.close)).toEqual([1, 2]);
    expect(await a.getBars({ instrument: 'EURUSD', timeframe: 'D1', asOf: at(5, 12) })).toBeNull();
  });

  it('prefers the finer file during replay even when a same-timeframe file exists', async () => {
    const a = load();
    a.importText('XAUUSD_H1.csv', '2026.01.05,10:00,1,2,1,2,0\n2026.01.05,11:00,2,3,2,3,0', { now: () => 0 });
    const live = await a.getBars({ instrument: 'XAUUSD', timeframe: 'H1' });
    expect(live!.source.label).toBe('File: XAUUSD_H1.csv');
    const replay = await a.getBars({ instrument: 'XAUUSD', timeframe: 'H1', asOf: t0 + 90 * 60 });
    expect(replay!.source.label).toMatch(/built from M1 bars/);
    expect(replay!.bars[1]!.close).toBe(189);
  });
});

describe('replay through the analysis layer', () => {
  const hourRows = (closes: number[]) => closes.map((c, i) => `2026.01.05,${String(i).padStart(2, '0')}:00,${c},${c},${c},${c},0`).join('\n');
  const day = Date.UTC(2026, 0, 5) / 1000;
  const files = new FileImportAdapter();
  files.importText('EURUSD_H1.csv', hourRows([1, 1.01, 1.02, 2, 3]));
  files.importText('USDJPY_H1.csv', hourRows([100, 101, 102, 150, 200]));
  files.importText('GBPUSD_H1.csv', hourRows([1.5, 1.5, 1.5, 1.5, 1.5]));
  const source = (asOf?: number) => ({
    getBars: async (req: BarRequest) => {
      const r = asOf === undefined ? req : { ...req, asOf };
      return (await files.getBars(r)) ?? (await getDerivedCross(files, r));
    },
  });

  it('caps "as of" at the replay moment and keeps later bars out', async () => {
    const at3 = day + 3 * 3600; // bars 00:00, 01:00, 02:00 have finished
    const loaded = await loadMany(source(at3), ['EURUSD', 'USDJPY'], 'H1');
    expect(loaded.asOf).toBe(at3);
    expect(loaded.replay).toBe(true);
    expect([...loaded.series.values()].map((s) => s.bars.length)).toEqual([3, 3]);
    const v = await strengthView(source(at3), 'H1', 1);
    // 01:00 -> 02:00 closes: EURUSD 1.01 -> 1.02, never the later jump to 2.
    expect(v.now!.average.EUR! < 2).toBe(true);
    expect(v.loaded.asOf).toBe(at3);
  });

  it('derived crosses obey the replay moment too', async () => {
    const s = await source(day + 2 * 3600).getBars({ instrument: 'EURGBP', timeframe: 'H1' });
    expect(s!.bars).toHaveLength(2);
    expect(s!.source.replayAt).toBe(day + 2 * 3600);
  });

  it('is not a replay when no moment is set', async () => {
    const loaded = await loadMany(source(), ['EURUSD', 'USDJPY'], 'H1');
    expect(loaded.replay).toBe(false);
    expect(loaded.asOf).toBe(day + 5 * 3600);
    const v = await linksView(source(), ['EURUSD', 'USDJPY'], 'H1', 3, 0.8);
    expect(v.links[0]!.n).toBe(3);
  });
});

describe('replay clock', () => {
  const extent = { first: 1000, last: 5000 };
  it('stays inside the data', () => {
    expect(clampReplay(0, extent)).toBe(1000);
    expect(clampReplay(9999, extent)).toBe(5000);
    expect(clampReplay(3000, extent)).toBe(3000);
  });

  it('steps by whole bars and stops at the ends', () => {
    expect(stepReplay(3000, 300, 1, extent)).toEqual({ time: 3300, atEnd: false });
    expect(stepReplay(3000, 300, -2, extent)).toEqual({ time: 2400, atEnd: false });
    expect(stepReplay(4900, 300, 1, extent)).toEqual({ time: 5000, atEnd: true });
    expect(stepReplay(1100, 300, -1, extent)).toEqual({ time: 1000, atEnd: true });
  });

  it('snaps a chosen moment down to a bar boundary', () => {
    expect(snapToStep(3725, 300)).toBe(3600);
    expect(snapToStep(3600, 3600)).toBe(3600);
    expect(snapToStep(86400 + 5, 86400)).toBe(86400);
  });
});
