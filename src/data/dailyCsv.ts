/**
 * Parsers for daily series files: the US Treasury yield curve CSV, and any
 * simple "date, value" file such as an index history. Pure functions.
 */
import type { Point } from '../calc/drivers';

export class DailyCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyCsvError';
  }
}

/** Split one CSV line, honouring double quotes. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

type DateOrder = 'ymd' | 'mdy' | 'dmy';

function dateParts(s: string): [string, string, string] | null {
  const m = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/.exec(s.trim());
  return m ? [m[1]!, m[2]!, m[3]!] : null;
}

/** Work out the date order from the whole column, so 03/04/2026 is not guessed row by row. */
function detectOrder(cells: string[]): DateOrder {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const cell of cells) {
    const p = dateParts(cell);
    if (!p) continue;
    if (p[0].length === 4) return 'ymd';
    if (Number(p[0]) > 12) firstOver12 = true;
    if (Number(p[1]) > 12) secondOver12 = true;
  }
  if (firstOver12 && !secondOver12) return 'dmy';
  return 'mdy'; // the US order, used by the Treasury and Cboe files
}

function toTime(cell: string, order: DateOrder): number | null {
  const p = dateParts(cell);
  if (!p) return null;
  const [a, b, c] = p.map(Number) as [number, number, number];
  const [y, m, d] = order === 'ymd' ? [a, b, c] : order === 'mdy' ? [c, a, b] : [c, b, a];
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  return new Date(ms).getUTCDate() === d ? ms / 1000 : null;
}

export interface ParsedDaily {
  points: Point[];
  /** The header name of the column that was read. */
  column: string;
  skipped: number;
}

/**
 * Read a daily series. The date is the first column whose header says
 * "date" (or simply the first column). The value is the column named in
 * `prefer`, else "close", "value" or "price", else the last numeric column.
 * Rows with an empty or unreadable value are skipped, never filled in.
 */
export function parseDailyCsv(text: string, prefer: readonly string[] = []): ParsedDaily {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new DailyCsvError('The file has no data rows.');
  const header = splitCsv(lines[0]!).map((c) => c.toLowerCase());
  const hasHeader = header.some((c) => /[a-z]/.test(c));
  if (!hasHeader) throw new DailyCsvError('The file needs a header row naming its columns, for example "date,close".');
  let dateCol = header.findIndex((c) => c.includes('date') || c === 'time' || c === 'day');
  if (dateCol === -1) dateCol = 0;
  const wanted = [...prefer.map((p) => p.toLowerCase()), 'close', 'value', 'price', 'last'];
  let valueCol = -1;
  for (const name of wanted) {
    valueCol = header.findIndex((c, i) => i !== dateCol && c === name);
    if (valueCol !== -1) break;
  }
  if (valueCol === -1) valueCol = header.length - 1;
  if (valueCol === dateCol) throw new DailyCsvError('No value column found beside the date.');

  const rows = lines.slice(1).map(splitCsv);
  const order = detectOrder(rows.map((r) => r[dateCol] ?? ''));
  const byTime = new Map<number, number>();
  let skipped = 0;
  for (const row of rows) {
    const time = toTime(row[dateCol] ?? '', order);
    const raw = row[valueCol] ?? '';
    const value = raw === '' ? NaN : Number(raw);
    if (time === null || !Number.isFinite(value)) {
      skipped++;
      continue;
    }
    byTime.set(time, value);
  }
  const points = [...byTime].map(([time, value]) => ({ time, value })).sort((p, q) => p.time - q.time);
  if (points.length === 0) throw new DailyCsvError('No rows with a readable date and number were found.');
  return { points, column: splitCsv(lines[0]!)[valueCol]!, skipped };
}

/** The 10-year column of the US Treasury daily par yield curve file. */
export function parseTreasuryYields(text: string): ParsedDaily {
  const parsed = parseDailyCsv(text, ['10 yr']);
  if (parsed.column.toLowerCase() !== '10 yr') throw new DailyCsvError('The Treasury file has no "10 Yr" column.');
  return parsed;
}

export const treasuryUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
