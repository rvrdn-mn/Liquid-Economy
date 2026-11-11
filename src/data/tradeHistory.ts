/**
 * Reads a trade history file into trades. Pure.
 *
 * Accepts a delimited file (CSV, tab or semicolon) or an HTML report, and
 * finds the trades table by its header row. Column names it understands:
 *
 *   open time     "open time", "entry time", or the first "time"
 *   close time    "close time", "exit time", or the second "time"
 *   symbol        "symbol", "item", "instrument", "pair"
 *   side          "type", "side", "direction" (buy / sell; other rows are skipped)
 *   volume        "volume", "size", "lots"
 *   prices        "open price" / "close price", "entry" / "exit", or the first and second "price"
 *   result        "profit", plus "commission", "swap", "taxes", "fee" when present
 *   id            "ticket", "position", "order", "id"
 *
 * That covers the simple layout documented in the README and the column
 * names MetaTrader 4 and 5 use in their history reports. The MetaTrader
 * layouts are written from their documented column names and have not yet
 * been checked against a real report.
 */
import type { Trade } from '../calc/journal';
import type { FileZone } from './fileZone';
import { normaliseSymbol } from './instruments';
import { parseDateTimeCell } from './mtCsv';

export class TradeHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradeHistoryError';
  }
}

export interface ParsedTrades {
  trades: Trade[];
  /** Rows under the header that were not trades (deposits, pending orders) or could not be read. */
  skipped: number;
  format: 'html' | 'delimited';
}

type Field = 'id' | 'openTime' | 'closeTime' | 'symbol' | 'side' | 'volume' | 'openPrice' | 'closePrice' | 'profit' | 'commission' | 'swap' | 'taxes';

const ALIASES: Record<string, Field> = {
  ticket: 'id', position: 'id', order: 'id', id: 'id', deal: 'id',
  opentime: 'openTime', entrytime: 'openTime', opendate: 'openTime', timeopen: 'openTime',
  closetime: 'closeTime', exittime: 'closeTime', closedate: 'closeTime', timeclose: 'closeTime',
  symbol: 'symbol', item: 'symbol', instrument: 'symbol', pair: 'symbol',
  type: 'side', side: 'side', direction: 'side', action: 'side',
  volume: 'volume', size: 'volume', lots: 'volume', quantity: 'volume',
  openprice: 'openPrice', entryprice: 'openPrice', entry: 'openPrice', priceopen: 'openPrice',
  closeprice: 'closePrice', exitprice: 'closePrice', exit: 'closePrice', priceclose: 'closePrice',
  profit: 'profit', pnl: 'profit', pl: 'profit', netprofit: 'profit', result: 'profit',
  commission: 'commission', fee: 'commission', fees: 'commission',
  swap: 'swap',
  taxes: 'taxes', tax: 'taxes',
};

const clean = (cell: string) => cell.toLowerCase().replace(/[^a-z]/g, '');

/** Map header cells to fields. A bare "time" or "price" means open first, close second. */
function mapHeader(cells: string[]): Partial<Record<Field, number>> | null {
  const map: Partial<Record<Field, number>> = {};
  let times = 0;
  let prices = 0;
  cells.forEach((cell, i) => {
    const name = clean(cell);
    let field: Field | undefined = ALIASES[name];
    if (name === 'time') field = times++ === 0 ? 'openTime' : 'closeTime';
    else if (name === 'price') field = prices++ === 0 ? 'openPrice' : 'closePrice';
    if (field && map[field] === undefined) map[field] = i;
  });
  const needed: Field[] = ['openTime', 'symbol', 'side', 'openPrice'];
  return needed.every((f) => map[f] !== undefined) ? map : null;
}

function htmlRows(text: string): string[][] {
  const rows: string[][] = [];
  const decode = (s: string) =>
    s
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
      .trim();
  for (const tr of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => decode(m[1]!));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function delimitedRows(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const count = (ch: string) => lines[0]!.split(ch).length - 1;
  const delimiter = count('\t') >= 3 ? '\t' : count(';') >= 3 ? ';' : ',';
  return lines.map((line) => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === delimiter && !quoted) {
        cells.push(cell.trim());
        cell = '';
      } else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  });
}

/** "1 234.56", "1,234.56", "1234,56" and "-12.5" to a number; NaN when it is not one. */
export function parseAmount(cell: string | undefined): number {
  if (cell === undefined) return NaN;
  let s = cell.replace(/[\s ]/g, '').replace(/^\+/, '');
  if (s === '') return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma !== -1) s = /,\d{3}$/.test(s) && s.indexOf(',') !== lastComma ? s.replace(/,/g, '') : s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

export function parseTradeHistory(text: string, zone: FileZone = 0): ParsedTrades {
  const isHtml = /<tr\b/i.test(text);
  const rows = isHtml ? htmlRows(text) : delimitedRows(text);
  let headerIndex = -1;
  let map: Partial<Record<Field, number>> | null = null;
  for (let i = 0; i < rows.length; i++) {
    map = mapHeader(rows[i]!);
    if (map) {
      headerIndex = i;
      break;
    }
  }
  if (!map || headerIndex === -1) {
    throw new TradeHistoryError('No trades table found. The file needs a header row with at least: time, symbol, type and price.');
  }
  const m = map;
  const width = rows[headerIndex]!.length;
  const trades: Trade[] = [];
  let skipped = 0;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]!;
    // A report's next section (orders, deals, a summary) has a different shape: stop there.
    if (isHtml && row.length !== width) {
      if (trades.length > 0) break;
      continue;
    }
    const get = (f: Field) => (m[f] === undefined ? undefined : row[m[f]!]);
    const sideCell = (get('side') ?? '').toLowerCase().trim();
    const side = sideCell === 'buy' || sideCell === 'long' ? 'buy' : sideCell === 'sell' || sideCell === 'short' ? 'sell' : null;
    const openTime = parseDateTimeCell(get('openTime') ?? '', zone);
    const openPrice = parseAmount(get('openPrice'));
    const symbol = (get('symbol') ?? '').trim();
    if (!side || openTime === null || !Number.isFinite(openPrice) || symbol === '') {
      skipped++;
      continue;
    }
    const closeCell = get('closeTime') ?? '';
    const closeTime = closeCell.trim() === '' ? null : parseDateTimeCell(closeCell, zone);
    const closePrice = parseAmount(get('closePrice'));
    const profit = parseAmount(get('profit'));
    const costs = (['commission', 'swap', 'taxes'] as const).reduce((sum, f) => {
      const v = parseAmount(get(f));
      return Number.isFinite(v) ? sum + v : sum;
    }, 0);
    const closed = closeTime !== null && Number.isFinite(closePrice) && closeTime >= openTime;
    const volume = parseAmount(get('volume'));
    trades.push({
      id: (get('id') ?? '').trim() || String(trades.length + 1),
      symbol,
      instrument: normaliseSymbol(symbol),
      side,
      volume: Number.isFinite(volume) ? volume : null,
      openTime,
      openPrice,
      closeTime: closed ? closeTime : null,
      closePrice: closed ? closePrice : null,
      result: closed && Number.isFinite(profit) ? profit + costs : null,
    });
  }
  if (trades.length === 0) throw new TradeHistoryError(`The trades table has no buy or sell rows that could be read (${skipped} rows skipped).`);
  trades.sort((a, b) => a.openTime - b.openTime);
  return { trades, skipped, format: isHtml ? 'html' : 'delimited' };
}
