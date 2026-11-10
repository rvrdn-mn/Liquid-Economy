import { describe, expect, it } from 'vitest';
import { decodeText, inferTimeframe, MtCsvError, parseMtFilename, parseMtPriceCsv } from '../src/data/mtCsv';

// The rows below are layout fixtures with made-up round numbers. They exist
// only to exercise the parser and are never shown as market data.

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;

const MT5_H1 = [
  '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>',
  '2026.01.05\t00:00:00\t100.00\t101.00\t99.50\t100.50\t1200\t0\t25',
  '2026.01.05\t01:00:00\t100.50\t102.00\t100.25\t101.75\t900\t0\t25',
  '2026.01.05\t02:00:00\t101.75\t101.90\t100.10\t100.20\t1100\t0\t30',
  '2026.01.05\t03:00:00\t100.20\t100.80\t99.90\t100.40\t700\t0\t30',
].join('\r\n');

describe('parseMtPriceCsv', () => {
  it('reads an MT5 intraday export', () => {
    const r = parseMtPriceCsv(MT5_H1);
    expect(r.format).toBe('mt5');
    expect(r.delimiter).toBe('\t');
    expect(r.hasHeader).toBe(true);
    expect(r.bars).toHaveLength(4);
    expect(r.bars[1]).toEqual({ time: utc(2026, 1, 5, 1), open: 100.5, high: 102, low: 100.25, close: 101.75, volume: 900 });
    expect(r.timeframe).toBe('H1');
    expect(r.skipped).toEqual([]);
  });

  it('reads an MT5 daily export, which has no time column', () => {
    const text = [
      '<DATE>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>',
      '2026.01.05\t100\t101\t99\t100.5\t5000\t0\t20',
      '2026.01.06\t100.5\t102\t100\t101\t5200\t0\t20',
      '2026.01.07\t101\t101.5\t100\t100.25\t4800\t0\t20',
    ].join('\n');
    const r = parseMtPriceCsv(text);
    expect(r.bars.map((b) => b.time)).toEqual([utc(2026, 1, 5), utc(2026, 1, 6), utc(2026, 1, 7)]);
    expect(r.bars[0]!.volume).toBe(5000);
    expect(r.timeframe).toBe('D1');
  });

  it('reads an MT4 History Center export (comma separated, no header)', () => {
    const text = [
      '2026.01.05,00:00,1.1000,1.1010,1.0990,1.1005,120',
      '2026.01.05,00:05,1.1005,1.1020,1.1000,1.1015,95',
      '2026.01.05,00:10,1.1015,1.1018,1.1002,1.1004,101',
    ].join('\n');
    const r = parseMtPriceCsv(text);
    expect(r.format).toBe('mt4');
    expect(r.hasHeader).toBe(false);
    expect(r.bars).toHaveLength(3);
    expect(r.bars[2]).toEqual({ time: utc(2026, 1, 5, 0, 10), open: 1.1015, high: 1.1018, low: 1.1002, close: 1.1004, volume: 101 });
    expect(r.timeframe).toBe('M5');
  });

  it('reads a generic file with a named header and one ISO date-time column', () => {
    const text = [
      'time,open,high,low,close',
      '2026-01-05T00:00:00Z,10,11,9,10.5',
      '2026-01-05 00:15,10.5,12,10,11',
      '2026-01-05T02:30:00+02:00,11,11.5,10.5,11.25',
    ].join('\n');
    const r = parseMtPriceCsv(text);
    expect(r.format).toBe('generic');
    expect(r.bars.map((b) => b.time)).toEqual([utc(2026, 1, 5, 0, 0), utc(2026, 1, 5, 0, 15), utc(2026, 1, 5, 0, 30)]);
    expect(r.bars[0]!.volume).toBeUndefined();
    expect(r.timeframe).toBe('M15');
  });

  it('reads a TradingView chart export with unix times', () => {
    const text = ['time,open,high,low,close,Volume', '1767571200,10,11,9,10.5,100', '1767574800000,10.5,12,10,11,120'].join('\n');
    const r = parseMtPriceCsv(text);
    expect(r.bars.map((b) => b.time)).toEqual([1767571200, 1767574800]);
    expect(r.bars[1]!.volume).toBe(120);
  });

  it('reads semicolon files that use a decimal comma', () => {
    const text = ['Date;Time;Open;High;Low;Close;Volume', '05.01.2026;08:00;1,1000;1,1050;1,0950;1,1025;300'].join('\n');
    const r = parseMtPriceCsv(text);
    expect(r.delimiter).toBe(';');
    expect(r.bars[0]).toEqual({ time: utc(2026, 1, 5, 8), open: 1.1, high: 1.105, low: 1.095, close: 1.1025, volume: 300 });
  });

  it('converts broker server time to UTC using the given offset', () => {
    // 02:00 on a UTC+2 server is 00:00 UTC.
    const r = parseMtPriceCsv('2026.01.05,02:00,1,2,1,2,0', { utcOffsetMinutes: 120 });
    expect(r.bars[0]!.time).toBe(utc(2026, 1, 5, 0));
    const west = parseMtPriceCsv('2026.01.05,19:00,1,2,1,2,0', { utcOffsetMinutes: -300 });
    expect(west.bars[0]!.time).toBe(utc(2026, 1, 6, 0));
  });

  it('skips and reports rows it cannot trust instead of repairing them', () => {
    const text = [
      '2026.01.05,00:00,100,101,99,100,1',
      '2026.01.05,01:00,100,99,98,100,1', // high below open
      '2026.02.31,02:00,100,101,99,100,1', // impossible date
      '2026.01.05,03:00,100,101,,100,1', // missing low
      '2026.01.05,04:00,100,101,99,0,1', // zero price
      'garbage,line,with,enough,commas,here,x',
      '2026.01.05,05:00,100,101,99,100,1',
    ].join('\n');
    const r = parseMtPriceCsv(text);
    expect(r.bars).toHaveLength(2);
    expect(r.skipped.map((s) => s.line)).toEqual([2, 3, 4, 5, 6]);
    expect(r.skipped[0]!.reason).toMatch(/high\/low/);
    expect(r.skipped[1]!.reason).toMatch(/date/);
  });

  it('sorts bars ascending', () => {
    const text = ['2026.01.05,02:00,3,3,3,3,0', '2026.01.05,00:00,1,1,1,1,0', '2026.01.05,01:00,2,2,2,2,0'].join('\n');
    expect(parseMtPriceCsv(text).bars.map((b) => b.close)).toEqual([1, 2, 3]);
  });

  it('combines rows that share a timestamp instead of dropping one', () => {
    // Seen in real HistData files: one minute split into a full row and a flat stub, in either order.
    const text = [
      '2026.01.05,04:03,100,106,99,104,3',
      '2026.01.05,04:03,104,104,104,104,1',
      '2026.01.05,04:04,104,104,104,104,1',
      '2026.01.05,04:04,103,108,102,107,4',
    ].join('\n');
    const r = parseMtPriceCsv(text);
    expect(r.duplicates).toBe(2);
    expect(r.bars).toEqual([
      { time: utc(2026, 1, 5, 4, 3), open: 100, high: 106, low: 99, close: 104, volume: 4 },
      { time: utc(2026, 1, 5, 4, 4), open: 104, high: 108, low: 102, close: 107, volume: 5 },
    ]);
  });

  it('counts an exactly repeated row once', () => {
    const row = '2026.01.05,04:03,100,106,99,104,3';
    const r = parseMtPriceCsv([row, row].join('\n'));
    expect(r.duplicates).toBe(1);
    expect(r.bars).toEqual([{ time: utc(2026, 1, 5, 4, 3), open: 100, high: 106, low: 99, close: 104, volume: 3 }]);
  });

  it('rejects files that are not price data', () => {
    expect(() => parseMtPriceCsv('')).toThrow(MtCsvError);
    expect(() => parseMtPriceCsv('hello world\nthis is a note')).toThrow(/Not a price file/);
    expect(() => parseMtPriceCsv('a,b,c,d,e\nf,g,h,i,j')).toThrow(/No price rows/);
  });
});

describe('decodeText', () => {
  it('decodes UTF-16 LE with a byte-order mark', () => {
    const body = '2026.01.05,00:00,1,2,1,2,0';
    const bytes = new Uint8Array(2 + body.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < body.length; i++) bytes[2 + i * 2] = body.charCodeAt(i);
    expect(decodeText(bytes)).toBe(body);
    expect(parseMtPriceCsv(decodeText(bytes)).bars).toHaveLength(1);
  });

  it('decodes UTF-8 and tolerates its byte-order mark', () => {
    const bytes = new TextEncoder().encode('\uFEFF2026.01.05,00:00,1,2,1,2,0');
    expect(parseMtPriceCsv(decodeText(bytes)).bars).toHaveLength(1);
  });
});

describe('inferTimeframe', () => {
  const bars = (times: number[]) => times.map((time) => ({ time, open: 1, high: 1, low: 1, close: 1 }));

  it('uses the most common gap, so weekend holes do not matter', () => {
    const fri = utc(2026, 1, 9, 20);
    const mon = utc(2026, 1, 12, 0);
    expect(inferTimeframe(bars([fri - 14400, fri, mon, mon + 14400, mon + 28800]))).toBe('H4');
  });

  it('returns null when it cannot tell', () => {
    expect(inferTimeframe(bars([0, 60, 120, 180]))).toBeNull(); // one-minute bars are not a supported timeframe
    expect(inferTimeframe(bars([0, 300]))).toBeNull();
  });
});

describe('parseMtFilename', () => {
  it('reads MT5 export names', () => {
    expect(parseMtFilename('XAUUSD_H1_202601020000_202611100000.csv')).toEqual({ instrument: 'XAUUSD', timeframe: 'H1', barSeconds: 3600 });
    expect(parseMtFilename('EURUSD_Daily_202501010000_202611100000.csv')).toEqual({ instrument: 'EURUSD', timeframe: 'D1', barSeconds: 86400 });
    expect(parseMtFilename('C:\\exports\\GBPJPY_M15_2026.csv')).toEqual({ instrument: 'GBPJPY', timeframe: 'M15', barSeconds: 900 });
  });

  it('reads MT4 export names, where the period is minutes after the symbol', () => {
    expect(parseMtFilename('EURUSD60.csv')).toMatchObject({ instrument: 'EURUSD', timeframe: 'H1' });
    expect(parseMtFilename('XAUUSD1440.csv')).toMatchObject({ instrument: 'XAUUSD', timeframe: 'D1' });
    expect(parseMtFilename('USDJPY5.csv')).toMatchObject({ instrument: 'USDJPY', timeframe: 'M5' });
  });

  it('reads HistData and TradingView names', () => {
    expect(parseMtFilename('DAT_MT_XAUUSD_M1_202610.csv')).toEqual({ instrument: 'XAUUSD', timeframe: null, barSeconds: 60 });
    expect(parseMtFilename('OANDA_XAUUSD, 60.csv')).toEqual({ instrument: 'XAUUSD', timeframe: 'H1', barSeconds: 3600 });
    expect(parseMtFilename('FX_EURUSD, 1D.csv')).toEqual({ instrument: 'EURUSD', timeframe: 'D1', barSeconds: 86400 });
    expect(parseMtFilename('OANDA_GBPUSD, 5.csv')).toMatchObject({ instrument: 'GBPUSD', timeframe: 'M5' });
  });

  it('copes with broker suffixes and unknown names', () => {
    expect(parseMtFilename('EURUSD.m_H4.csv')).toMatchObject({ instrument: 'EURUSD', timeframe: 'H4' });
    expect(parseMtFilename('GOLD_H1.csv')).toMatchObject({ instrument: 'XAUUSD', timeframe: 'H1' });
    expect(parseMtFilename('prices.csv')).toEqual({ instrument: null, timeframe: null, barSeconds: null });
    expect(parseMtFilename('EURUSD_W1.csv')).toEqual({ instrument: 'EURUSD', timeframe: null, barSeconds: null });
  });
});
