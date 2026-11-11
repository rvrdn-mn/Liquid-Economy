import { describe, expect, it } from 'vitest';
import { journalStats, sessionLabel, type Trade } from '../src/calc/journal';
import { parseAmount, parseTradeHistory, TradeHistoryError } from '../src/data/tradeHistory';

// Made-up trades, used only to check the arithmetic and the file reading.

const at = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
const trade = (openTime: number, result: number | null, extra: Partial<Trade> = {}): Trade => ({
  id: '1', symbol: 'XAUUSD', instrument: 'XAUUSD', side: 'buy', volume: 0.1, openTime, openPrice: 100, closeTime: result === null ? null : openTime + 3600, closePrice: result === null ? null : 101, result, ...extra,
});

describe('journal statistics', () => {
  // July 2026: 13th is a Monday. Hours in UTC: 03 Asia, 08 Asia + London, 13 London + New York, 18 New York, 22 none.
  const trades = [
    trade(at(2026, 7, 13, 3), 100),
    trade(at(2026, 7, 13, 8), -40),
    trade(at(2026, 7, 14, 13), 60),
    trade(at(2026, 7, 14, 18), -20),
    trade(at(2026, 7, 15, 22), 0),
    trade(at(2026, 7, 16, 3), 50),
    trade(at(2026, 7, 16, 4), null), // still open: not counted
  ];
  const s = journalStats(trades);

  it('win rate, averages and profit factor, worked by hand', () => {
    expect(s.trades).toBe(6);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(2);
    expect(s.breakeven).toBe(1);
    expect(s.winRate).toBeCloseTo(3 / 6, 12);
    expect(s.averageWin).toBeCloseTo((100 + 60 + 50) / 3, 12);
    expect(s.averageLoss).toBeCloseTo(-(40 + 20) / 2, 12);
    expect(s.profitFactor).toBeCloseTo(210 / 60, 12);
    expect(s.net).toBe(150);
  });

  it('results by session, with overlaps as their own bucket', () => {
    expect(s.bySession).toEqual([
      { label: 'Asia', tally: { trades: 2, wins: 2, losses: 0, net: 150 } },
      { label: 'Asia + London', tally: { trades: 1, wins: 0, losses: 1, net: -40 } },
      { label: 'London + New York', tally: { trades: 1, wins: 1, losses: 0, net: 60 } },
      { label: 'New York', tally: { trades: 1, wins: 0, losses: 1, net: -20 } },
      { label: 'Outside sessions', tally: { trades: 1, wins: 0, losses: 0, net: 0 } },
    ]);
    expect(sessionLabel(at(2026, 7, 13, 10))).toBe('London');
    expect(sessionLabel(at(2026, 7, 18, 10))).toBe('Outside sessions'); // Saturday
  });

  it('results by day of week, on the clock the caller chooses', () => {
    expect(s.byWeekday.map((d) => d.trades)).toEqual([0, 2, 2, 1, 1, 0, 0]); // Sun..Sat
    expect(s.byWeekday[1]).toEqual({ trades: 2, wins: 1, losses: 1, net: 60 });
    // In a zone five and a half hours ahead, Wednesday 22:00 UTC is already Thursday.
    const ist = journalStats(trades, (t) => new Date((t + 5.5 * 3600) * 1000).getUTCDay());
    expect(ist.byWeekday.map((d) => d.trades)).toEqual([0, 2, 2, 0, 2, 0, 0]);
  });

  it('has no value for a measure that cannot be worked out', () => {
    const none = journalStats([]);
    expect(none).toMatchObject({ trades: 0, winRate: null, averageWin: null, averageLoss: null, profitFactor: null });
    const onlyWins = journalStats([trade(at(2026, 7, 13, 3), 10)]);
    expect(onlyWins.profitFactor).toBeNull(); // nothing lost: the ratio has no value
    expect(onlyWins.averageLoss).toBeNull();
    expect(onlyWins.winRate).toBe(1);
  });
});

describe('reading trade history files', () => {
  it('reads the simple CSV layout', () => {
    const csv = [
      'id,symbol,type,volume,open time,open price,close time,close price,commission,swap,profit',
      '1,XAUUSD,buy,0.10,2026-07-13 03:00,4000.00,2026-07-14 09:30,4025.50,-0.70,-0.25,255.00',
      '2,EURUSD,sell,0.20,2026-07-15 13:00,1.12000,2026-07-15 18:00,1.12300,-1.40,0,-60.00',
    ].join('\n');
    const r = parseTradeHistory(csv);
    expect(r.format).toBe('delimited');
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toEqual({
      id: '1', symbol: 'XAUUSD', instrument: 'XAUUSD', side: 'buy', volume: 0.1,
      openTime: at(2026, 7, 13, 3), openPrice: 4000, closeTime: at(2026, 7, 14, 9, 30), closePrice: 4025.5,
      result: 255 - 0.7 - 0.25,
    });
    expect(r.trades[1]!.result).toBeCloseTo(-61.4, 9);
  });

  it('reads MetaTrader 5 report columns, where time and price appear twice', () => {
    const html = `<html><body><table>
      <tr><th colspan="13">Positions</th></tr>
      <tr><td>Time</td><td>Position</td><td>Symbol</td><td>Type</td><td>Volume</td><td>Price</td><td>S / L</td><td>T / P</td><td>Time</td><td>Price</td><td>Commission</td><td>Swap</td><td>Profit</td></tr>
      <tr><td>2026.07.13 03:00:00</td><td>1001</td><td>XAUUSD.m</td><td>buy</td><td>0.10</td><td>4 000.00</td><td></td><td></td><td>2026.07.14 09:30:00</td><td>4 025.50</td><td>-0.70</td><td>0.00</td><td>255.00</td></tr>
      <tr><td>2026.07.15 13:00:00</td><td>1002</td><td>EURUSD.m</td><td>sell</td><td>0.20</td><td>1.12000</td><td></td><td></td><td>2026.07.15 18:00:00</td><td>1.12300</td><td>-1.40</td><td>0.00</td><td>-60.00</td></tr>
      <tr><th colspan="13">Orders</th></tr>
      <tr><td>Open Time</td><td>Order</td><td>Symbol</td><td>Type</td></tr>
      <tr><td>2026.07.13 03:00:00</td><td>5</td><td>XAUUSD.m</td><td>buy</td></tr>
    </table></body></html>`;
    const r = parseTradeHistory(html);
    expect(r.format).toBe('html');
    expect(r.trades.map((t) => [t.id, t.instrument, t.side, t.openPrice, t.closePrice, t.result])).toEqual([
      ['1001', 'XAUUSD', 'buy', 4000, 4025.5, 254.3],
      ['1002', 'EURUSD', 'sell', 1.12, 1.123, -61.4],
    ]);
  });

  it('reads MetaTrader 4 statement columns and skips rows that are not trades', () => {
    const html = `<table>
      <tr><td>Ticket</td><td>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td>Close Time</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>
      <tr><td>7</td><td>2026.07.13 03:00</td><td>balance</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>5 000.00</td></tr>
      <tr><td>8</td><td>2026.07.13 05:00</td><td>buy</td><td>0.10</td><td>xauusd</td><td>4000.00</td><td>0</td><td>0</td><td>2026.07.13 09:00</td><td>4010.00</td><td>0.00</td><td>0.00</td><td>-0.50</td><td>100.00</td></tr>
      <tr><td>9</td><td>2026.07.13 06:00</td><td>buy limit</td><td>0.10</td><td>xauusd</td><td>3990.00</td><td>0</td><td>0</td><td>2026.07.13 07:00</td><td>3990.00</td><td></td><td></td><td></td><td>cancelled</td></tr>
    </table>`;
    const r = parseTradeHistory(html, 120); // server clock two hours ahead of UTC
    expect(r.trades).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.trades[0]).toMatchObject({ id: '8', instrument: 'XAUUSD', openTime: at(2026, 7, 13, 3), closeTime: at(2026, 7, 13, 7), result: 99.5 });
  });

  it('keeps a trade that is still open, with no result', () => {
    const csv = 'symbol,type,open time,open price,close time,close price,profit\nGBPJPY,sell,2026-07-13 03:00,200.5,,,';
    const t = parseTradeHistory(csv).trades[0]!;
    expect(t).toMatchObject({ instrument: 'GBPJPY', closeTime: null, closePrice: null, result: null, volume: null });
  });

  it('keeps symbols it does not chart, without an instrument', () => {
    const csv = 'symbol,type,open time,open price,close time,close price,profit\nBTCUSD,buy,2026-07-13 03:00,60000,2026-07-13 04:00,60100,10';
    expect(parseTradeHistory(csv).trades[0]).toMatchObject({ symbol: 'BTCUSD', instrument: null, result: 10 });
  });

  it('reads amounts in the common styles', () => {
    expect(parseAmount('1 234.56')).toBe(1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1234,56')).toBe(1234.56);
    expect(parseAmount('-12.5')).toBe(-12.5);
    expect(parseAmount('+3')).toBe(3);
    expect(Number.isNaN(parseAmount('cancelled'))).toBe(true);
    expect(Number.isNaN(parseAmount(''))).toBe(true);
  });

  it('explains what is wrong with an unusable file', () => {
    expect(() => parseTradeHistory('just some text')).toThrow(TradeHistoryError);
    expect(() => parseTradeHistory('a,b,c\n1,2,3')).toThrow(/No trades table/);
    expect(() => parseTradeHistory('symbol,type,open time,open price\nXAUUSD,balance,2026-07-13,1')).toThrow(/no buy or sell rows/);
  });
});
