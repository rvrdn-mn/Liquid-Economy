import { describe, expect, it } from 'vitest';
import { aggregateBars } from '../src/data/aggregate';
import { FileImportAdapter } from '../src/data/fileAdapter';
import type { Bar } from '../src/data/types';

// Layout fixtures with made-up round numbers, used only to test the maths.

const t0 = Date.UTC(2026, 0, 5, 10, 0) / 1000;
const bar = (minute: number, open: number, high: number, low: number, close: number, volume?: number): Bar => {
  const b: Bar = { time: t0 + minute * 60, open, high, low, close };
  if (volume !== undefined) b.volume = volume;
  return b;
};

describe('aggregateBars', () => {
  it('takes first open, highest high, lowest low, last close and summed volume', () => {
    const fine = [bar(0, 10, 12, 9, 11, 5), bar(1, 11, 15, 10, 14, 3), bar(2, 14, 14, 8, 9, 2), bar(5, 9, 10, 9, 10, 1)];
    expect(aggregateBars(fine, 300)).toEqual([
      { time: t0, open: 10, high: 15, low: 8, close: 9, volume: 10 },
      { time: t0 + 300, open: 9, high: 10, low: 9, close: 10, volume: 1 },
    ]);
  });

  it('leaves empty windows empty instead of filling them', () => {
    const fine = [bar(0, 1, 1, 1, 1), bar(125, 2, 2, 2, 2)];
    const hourly = aggregateBars(fine, 3600);
    expect(hourly.map((b) => b.time)).toEqual([t0, t0 + 7200]);
  });

  it('drops volume when any bar in the window has none', () => {
    const out = aggregateBars([bar(0, 1, 1, 1, 1, 4), bar(1, 1, 1, 1, 1)], 300);
    expect(out[0]!.volume).toBeUndefined();
  });

  it('can shift where windows start', () => {
    // Daily bars that roll at 22:00 UTC: offset of two hours.
    const late = { time: Date.UTC(2026, 0, 5, 22, 30) / 1000, open: 1, high: 1, low: 1, close: 1 };
    expect(aggregateBars([late], 86400)[0]!.time).toBe(Date.UTC(2026, 0, 5) / 1000);
    expect(aggregateBars([late], 86400, 7200)[0]!.time).toBe(Date.UTC(2026, 0, 5, 22) / 1000);
  });

  it('rejects unsorted input and bad sizes', () => {
    expect(() => aggregateBars([bar(10, 1, 1, 1, 1), bar(0, 1, 1, 1, 1)], 300)).toThrow(/ascending/);
    expect(() => aggregateBars([], 0)).toThrow(RangeError);
  });
});

describe('FileImportAdapter building coarser timeframes', () => {
  // 130 one-minute bars from 10:00; price rises by 1 each minute.
  const rows = Array.from({ length: 130 }, (_, i) => {
    const d = new Date((t0 + i * 60) * 1000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `2026.01.05,${hh}:${mm},${100 + i},${100.5 + i},${99.5 + i},${100 + i},0`;
  }).join('\n');

  const load = () => {
    const a = new FileImportAdapter();
    const result = a.importText('DAT_MT_XAUUSD_M1_202601.csv', rows, { now: () => 0 });
    return { a, result };
  };

  it('accepts a one-minute file and reports what it can serve', () => {
    const { a, result } = load();
    expect(result.series).toMatchObject({ instrument: 'XAUUSD', timeframe: 'M1', barSeconds: 60 });
    expect(result.serves).toEqual(['M5', 'M15', 'H1', 'H4', 'D1']);
    expect(a.capabilities().timeframes).toEqual(['M5', 'M15', 'H1', 'H4', 'D1']);
  });

  it('builds hourly bars from one-minute bars and says so in the source', async () => {
    const { a } = load();
    const h1 = await a.getBars({ instrument: 'XAUUSD', timeframe: 'H1' });
    expect(h1!.bars).toEqual([
      { time: t0, open: 100, high: 159.5, low: 99.5, close: 159, volume: 0 },
      { time: t0 + 3600, open: 160, high: 219.5, low: 159.5, close: 219, volume: 0 },
      { time: t0 + 7200, open: 220, high: 229.5, low: 219.5, close: 229, volume: 0 },
    ]);
    expect(h1!.source.label).toBe('File: DAT_MT_XAUUSD_M1_202601.csv (built from M1 bars)');
    expect(h1!.source.asOf).toBe(t0 + 129 * 60);
  });

  it('when cut at a past time, the last built bar holds nothing from after it', async () => {
    const { a } = load();
    const cut = t0 + 90 * 60; // 11:30
    const h1 = await a.getBars({ instrument: 'XAUUSD', timeframe: 'H1', to: cut });
    const last = h1!.bars[h1!.bars.length - 1]!;
    expect(last.time).toBe(t0 + 3600);
    expect(last.close).toBe(190); // the 11:30 minute bar, not the 11:59 one
    expect(last.high).toBe(190.5);
    expect(h1!.source.asOf).toBe(cut);
  });

  it('prefers a real file of the requested timeframe over building one', async () => {
    const { a } = load();
    a.importText('XAUUSD_H1.csv', '2026.01.05,10:00,1,2,1,2,7\n2026.01.05,11:00,2,3,2,3,7', { now: () => 0 });
    const h1 = await a.getBars({ instrument: 'XAUUSD', timeframe: 'H1' });
    expect(h1!.bars[0]!.close).toBe(2);
    expect(h1!.source.label).toBe('File: XAUUSD_H1.csv');
  });

  it('does not build bigger bars from close-only reference data', async () => {
    const a = new FileImportAdapter();
    const r = a.importText('EURUSD_H1.csv', '2026.01.05,10:00,1,1,1,1,0\n2026.01.05,11:00,2,2,2,2,0', {
      source: { closeOnly: true },
    });
    expect(r.serves).toEqual(['H1']);
    expect(await a.getBars({ instrument: 'EURUSD', timeframe: 'H4' })).toBeNull();
  });
});
