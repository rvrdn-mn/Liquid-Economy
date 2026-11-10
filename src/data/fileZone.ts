/**
 * The clock a price file was written in. A file never says, so the user
 * picks one when importing.
 *
 *  number        fixed offset from UTC in minutes
 *  'histdata'    HistData.com files. Their FAQ says "EST without daylight
 *                saving", but a real file (October 2026 gold) shows
 *                otherwise: the US jobs report spike sits at 08:30 file
 *                time on 2 October, which is UTC-4, and the daily market
 *                break moves by an hour on 26 October, the day after
 *                Europe's clocks changed. The clock that fits is European
 *                trading-server time minus seven hours: UTC-4 while Europe
 *                is on summer time, UTC-5 otherwise.
 *  'ny-close'    The usual MetaTrader broker server clock: New York time
 *                plus seven hours (UTC+2, or UTC+3 during US daylight
 *                time), so the trading day starts at server midnight.
 *                Not yet checked against a real broker file.
 */
import { newYorkOffsetSeconds } from './aggregate';

export type FileZone = number | 'histdata' | 'ny-close';

const HOUR = 3600;

function lastSundayUtc(year: number, monthIndex: number, utcHour: number): number {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return Date.UTC(year, monthIndex, last.getUTCDate() - last.getUTCDay(), utcHour) / 1000;
}

/** European summer time: last Sunday of March to last Sunday of October, changing at 01:00 UTC. */
export function isEuropeanSummerTime(time: number): boolean {
  const year = new Date(time * 1000).getUTCFullYear();
  return time >= lastSundayUtc(year, 2, 1) && time < lastSundayUtc(year, 9, 1);
}

function offsetAt(zone: Exclude<FileZone, number>, time: number): number {
  if (zone === 'histdata') return isEuropeanSummerTime(time) ? -4 * HOUR : -5 * HOUR;
  return newYorkOffsetSeconds(time) + 7 * HOUR;
}

/**
 * Convert a wall-clock reading (seconds, as if the clock were UTC) to real
 * UTC seconds. Readings inside a clock-change hour are ambiguous; markets
 * are shut at those moments, so the first interpretation is used.
 */
export function wallClockToUtc(wallSeconds: number, zone: FileZone): number {
  if (typeof zone === 'number') return wallSeconds - zone * 60;
  const guess = wallSeconds - offsetAt(zone, wallSeconds);
  return wallSeconds - offsetAt(zone, guess);
}

export function isFileZone(value: unknown): value is FileZone {
  if (value === 'histdata' || value === 'ny-close') return true;
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 14 * 60;
}

export function fileZoneLabel(zone: FileZone): string {
  if (zone === 'histdata') return 'HistData.com';
  if (zone === 'ny-close') return 'MetaTrader server (UTC+2/+3)';
  if (zone === 0) return 'UTC';
  const hours = zone / 60;
  return `UTC${hours > 0 ? '+' : ''}${hours}`;
}
