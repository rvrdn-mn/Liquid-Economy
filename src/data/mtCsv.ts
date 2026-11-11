/**
 * Parser for MetaTrader price-history exports. Pure functions, no I/O.
 *
 * Layouts handled (auto-detected):
 *
 *  MT5  Symbols > Bars > Export Bars. Tab separated, header in angle brackets:
 *         <DATE>  <TIME>  <OPEN>  <HIGH>  <LOW>  <CLOSE>  <TICKVOL>  <VOL>  <SPREAD>
 *         2026.11.09  13:00:00  4081.32  4089.58  4079.10  4082.89  5321  0  25
 *       Daily exports have no <TIME> column.
 *
 *  MT4  History Center > Export. Comma separated, no header:
 *         2026.11.09,13:00,4081.32,4089.58,4079.10,4082.89,5321
 *
 *  Generic  any delimited file with a header naming date/time/open/high/
 *       low/close columns, or a single ISO date-time column.
 *
 * Files carry times in their source's own clock, not UTC, and do not say
 * which. The caller passes the clock as `zone` (a setting; see fileZone.ts).
 * Bar.time is always stored as UTC.
 *
 * Rows that cannot be read are skipped and reported, never repaired. Rows
 * that share a timestamp are combined into one bar and counted.
 */
import { TIMEFRAME_SECONDS, TIMEFRAMES, type Bar, type InstrumentId, type Timeframe } from './types';
import { normaliseSymbol } from './instruments';
import { wallClockToUtc, type FileZone } from './fileZone';

export type MtFormat = 'mt5' | 'mt4' | 'generic';

export interface ParseOptions {
  /** Fixed offset of the file's timestamps from UTC, in minutes. Default 0. */
  utcOffsetMinutes?: number;
  /** The file's clock, when it is not a fixed offset. Wins over `utcOffsetMinutes`. */
  zone?: FileZone;
}

export interface SkippedRow {
  /** 1-based line number in the file. */
  line: number;
  reason: string;
}

export interface ParsedPriceFile {
  format: MtFormat;
  delimiter: '\t' | ',' | ';';
  hasHeader: boolean;
  /** Ascending, de-duplicated. */
  bars: Bar[];
  /** Inferred from the most common gap between bars; null if unclear. */
  timeframe: Timeframe | null;
  /** Most common gap between bars in seconds (60 for one-minute files). */
  barSeconds: number | null;
  skipped: SkippedRow[];
  /** Rows that shared a timestamp with an earlier row and were folded into it. */
  duplicates: number;
}

export class MtCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MtCsvError';
  }
}

/** Decode file bytes. MetaTrader sometimes writes UTF-16 with a BOM. */
export function decodeText(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  return new TextDecoder('utf-8').decode(u8);
}

type ColumnKey = 'date' | 'time' | 'datetime' | 'open' | 'high' | 'low' | 'close' | 'volume';
type ColumnMap = Partial<Record<ColumnKey, number>>;

const HEADER_ALIASES: Record<string, ColumnKey> = {
  date: 'date',
  time: 'time',
  datetime: 'datetime',
  timestamp: 'datetime',
  open: 'open',
  high: 'high',
  low: 'low',
  close: 'close',
  tickvol: 'volume',
  tickvolume: 'volume',
  volume: 'volume',
};

function detectDelimiter(line: string): '\t' | ',' | ';' {
  const count = (ch: string) => line.split(ch).length - 1;
  const tabs = count('\t');
  const semis = count(';');
  const commas = count(',');
  if (tabs >= 3) return '\t';
  if (semis >= 3) return ';';
  if (commas >= 3) return ',';
  throw new MtCsvError('Not a price file: no tab, comma or semicolon separated columns found.');
}

function cleanHeaderCell(cell: string): string {
  return cell.replace(/[<>"'\s_]/g, '').toLowerCase();
}

function readHeader(cells: string[]): ColumnMap | null {
  const names = cells.map(cleanHeaderCell);
  if (!names.some((n) => n === 'open') || !names.some((n) => n === 'close')) return null;
  const map: ColumnMap = {};
  names.forEach((name, i) => {
    const key = HEADER_ALIASES[name];
    // First match wins, so <TICKVOL> is preferred over the later <VOL>.
    if (key && map[key] === undefined) map[key] = i;
  });
  // A lone "time" column with no "date" column holds the full date-time.
  if (map.date === undefined && map.time !== undefined && map.datetime === undefined) {
    map.datetime = map.time;
    delete map.time;
  }
  return map;
}

const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

function headerlessMap(cells: string[]): ColumnMap {
  const hasTime = cells.length > 1 && TIME_RE.test(cells[1]!.trim());
  const o = hasTime ? 2 : 1;
  const map: ColumnMap = { date: 0, open: o, high: o + 1, low: o + 2, close: o + 3 };
  if (hasTime) map.time = 1;
  if (cells.length > o + 4) map.volume = o + 4;
  return map;
}

/** Parse "2026.11.09", "2026-11-09", "2026/11/09", "20261109" or "09.11.2026". */
function parseDateParts(s: string): [number, number, number] | null {
  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(s);
  if (m) return [Number(m[3]), Number(m[2]), Number(m[1])];
  return null;
}

function parseTimeParts(s: string): [number, number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return [h, min, sec];
}

/** Returns UTC epoch seconds for a wall-clock time read in the given clock. */
function toEpochSeconds(date: string, time: string | undefined, zone: FileZone): number | null {
  const d = parseDateParts(date.trim());
  if (!d) return null;
  const t = time === undefined || time.trim() === '' ? ([0, 0, 0] as const) : parseTimeParts(time.trim());
  if (!t) return null;
  const [y, mo, day] = d;
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(y, mo - 1, day, t[0], t[1], t[2]);
  // Reject impossible dates such as 31 February, which Date.UTC rolls over.
  if (new Date(ms).getUTCDate() !== day) return null;
  return wallClockToUtc(ms / 1000, zone);
}

/** Unix time in seconds (9-10 digits) or milliseconds (13 digits), else null. */
function parseUnixTime(s: string): number | null {
  const trimmed = s.trim().replace(/^"|"$/g, '');
  if (/^\d{9,10}$/.test(trimmed)) return Number(trimmed);
  if (/^\d{13}$/.test(trimmed)) return Math.floor(Number(trimmed) / 1000);
  return null;
}

function splitDateTime(s: string): { date: string; time?: string; offsetMinutes?: number } {
  const trimmed = s.trim().replace(/^"|"$/g, '');
  const m = /^(\S+?)[T ](\d{1,2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(trimmed);
  if (!m) return { date: trimmed };
  const out: { date: string; time?: string; offsetMinutes?: number } = { date: m[1]!, time: m[2]! };
  const zone = m[3];
  if (zone === 'Z') out.offsetMinutes = 0;
  else if (zone) {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    out.offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  return out;
}

/**
 * One date-time cell to UTC epoch seconds: "2026.01.05 13:30", ISO text
 * with or without an offset, or a unix number. Null when unreadable.
 */
export function parseDateTimeCell(cell: string, zone: FileZone): number | null {
  const unix = parseUnixTime(cell);
  if (unix !== null) return unix;
  const dt = splitDateTime(cell);
  return toEpochSeconds(dt.date, dt.time, dt.offsetMinutes ?? zone);
}

function parseNumber(cell: string | undefined, decimalComma: boolean): number {
  if (cell === undefined) return NaN;
  let s = cell.trim().replace(/^"|"$/g, '');
  if (s === '') return NaN;
  if (decimalComma) s = s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** Most common gap between consecutive bars, in seconds; null if too few bars. */
export function inferBarSeconds(bars: readonly Bar[]): number | null {
  if (bars.length < 3) return null;
  const counts = new Map<number, number>();
  for (let i = 1; i < bars.length; i++) {
    const gap = bars[i]!.time - bars[i - 1]!.time;
    counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [gap, n] of counts) {
    if (n > bestCount) {
      best = gap;
      bestCount = n;
    }
  }
  return best;
}

/** Bar spacing matched to one of the app's timeframes; null if it is none of them. */
export function inferTimeframe(bars: readonly Bar[]): Timeframe | null {
  const seconds = inferBarSeconds(bars);
  return TIMEFRAMES.find((tf) => TIMEFRAME_SECONDS[tf] === seconds) ?? null;
}

export function parseMtPriceCsv(text: string, options: ParseOptions = {}): ParsedPriceFile {
  const zone: FileZone = options.zone ?? options.utcOffsetMinutes ?? 0;
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  if (firstIdx === -1) throw new MtCsvError('The file is empty.');

  const delimiter = detectDelimiter(lines[firstIdx]!);
  const firstCells = lines[firstIdx]!.split(delimiter);
  const headerMap = readHeader(firstCells);
  const hasHeader = headerMap !== null;
  const map = headerMap ?? headerlessMap(firstCells);

  if (map.date === undefined && map.datetime === undefined) {
    throw new MtCsvError('No date column found.');
  }
  for (const key of ['open', 'high', 'low', 'close'] as const) {
    if (map[key] === undefined) throw new MtCsvError(`No ${key} column found.`);
  }

  // A comma can only be a decimal mark when it is not the column separator.
  const decimalComma = delimiter !== ',';
  const skipped: SkippedRow[] = [];
  const byTime = new Map<number, Bar>();
  let duplicates = 0;

  for (let i = hasHeader ? firstIdx + 1 : firstIdx; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    const cells = raw.split(delimiter);
    const lineNo = i + 1;

    let time: number | null;
    if (map.datetime !== undefined) {
      const cell = cells[map.datetime] ?? '';
      const unix = parseUnixTime(cell);
      if (unix !== null) time = unix;
      else {
        const dt = splitDateTime(cell);
        time = toEpochSeconds(dt.date, dt.time, dt.offsetMinutes ?? zone);
      }
    } else {
      const timeCell = map.time !== undefined ? cells[map.time] : undefined;
      time = toEpochSeconds(cells[map.date!] ?? '', timeCell, zone);
    }
    if (time === null) {
      skipped.push({ line: lineNo, reason: 'unreadable date or time' });
      continue;
    }

    const open = parseNumber(cells[map.open!], decimalComma);
    const high = parseNumber(cells[map.high!], decimalComma);
    const low = parseNumber(cells[map.low!], decimalComma);
    const close = parseNumber(cells[map.close!], decimalComma);
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) {
      skipped.push({ line: lineNo, reason: 'missing or non-positive price' });
      continue;
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      skipped.push({ line: lineNo, reason: 'high/low do not contain open/close' });
      continue;
    }

    const bar: Bar = { time, open, high, low, close };
    if (map.volume !== undefined) {
      const volume = parseNumber(cells[map.volume], decimalComma);
      if (Number.isFinite(volume) && volume >= 0) bar.volume = volume;
    }
    const earlier = byTime.get(time);
    if (!earlier) {
      byTime.set(time, bar);
      continue;
    }
    // Two rows for one timestamp. Identical rows (overlapping exports) count
    // once. Different rows are pieces of the same bar, in file order, so they
    // are combined; dropping either would lose part of the real range.
    duplicates++;
    const same =
      earlier.open === open && earlier.high === high && earlier.low === low && earlier.close === close && earlier.volume === bar.volume;
    if (same) continue;
    earlier.high = Math.max(earlier.high, high);
    earlier.low = Math.min(earlier.low, low);
    earlier.close = close;
    if (earlier.volume !== undefined && bar.volume !== undefined) earlier.volume += bar.volume;
    else delete earlier.volume;
  }

  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (bars.length === 0) {
    throw new MtCsvError(`No price rows could be read (${skipped.length} rows skipped).`);
  }

  const format: MtFormat = hasHeader
    ? firstCells.some((c) => /^\s*<\w+>\s*$/.test(c))
      ? 'mt5'
      : 'generic'
    : delimiter === ','
      ? 'mt4'
      : 'generic';

  return { format, delimiter, hasHeader, bars, timeframe: inferTimeframe(bars), barSeconds: inferBarSeconds(bars), skipped, duplicates };
}

/** Seconds per bar for the period words and minute counts used in file names. */
const NAME_PERIODS: Record<string, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  H1: 3600,
  H4: 14400,
  D1: 86400,
  DAILY: 86400,
  '1D': 86400,
  D: 86400,
  '1': 60,
  '5': 300,
  '15': 900,
  '60': 3600,
  '240': 14400,
  '1440': 86400,
};

export interface FileNameInfo {
  instrument: InstrumentId | null;
  /** One of the app's timeframes, or null (unknown, or one-minute). */
  timeframe: Timeframe | null;
  /** Seconds per bar when the name says, including 60 for one-minute files. */
  barSeconds: number | null;
}

/**
 * Read instrument and period from an export's file name.
 *   MT5:         XAUUSD_H1_202601020000_202611100000.csv, XAUUSD_Daily_....csv
 *   MT4:         EURUSD60.csv, XAUUSD1440.csv
 *   HistData:    DAT_MT_XAUUSD_M1_202610.csv
 *   TradingView: "OANDA_XAUUSD, 60.csv", "FX_EURUSD, 1D.csv"
 * Any part is null when the name does not say.
 */
export function parseMtFilename(fileName: string): FileNameInfo {
  const stem = fileName.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]+$/, '');
  const parts = stem.split(/[_\-\s,]+/).filter(Boolean);

  let instrument: InstrumentId | null = null;
  let symbolIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    const found = normaliseSymbol(parts[i]!.replace(/\d+$/, ''));
    if (found) {
      instrument = found;
      symbolIndex = i;
      break;
    }
  }

  let barSeconds: number | null = null;
  for (const part of parts.slice(symbolIndex + 1)) {
    const seconds = NAME_PERIODS[part.toUpperCase()];
    if (seconds) {
      barSeconds = seconds;
      break;
    }
  }
  if (barSeconds === null && symbolIndex >= 0) {
    const trailing = /(\d+)$/.exec(parts[symbolIndex]!);
    if (trailing) barSeconds = NAME_PERIODS[trailing[1]!] ?? null;
  }
  const timeframe = TIMEFRAMES.find((tf) => TIMEFRAME_SECONDS[tf] === barSeconds) ?? null;
  return { instrument, timeframe, barSeconds };
}
