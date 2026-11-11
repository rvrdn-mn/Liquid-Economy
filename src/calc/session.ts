/**
 * Sessions and the session profile (spec section 6).
 *
 * Session profile: average high-low range for each hour of the day over
 * the last 30 days, per pair.
 *
 * Sessions are defined by each centre's own business hours, so their UTC
 * times move with that centre's daylight saving.
 */
import { newYorkOffsetSeconds } from '../data/aggregate';
import { isEuropeanSummerTime } from '../data/fileZone';
import type { Bar } from '../data/types';

export type SessionName = 'Asia' | 'London' | 'New York';

export interface SessionDef {
  name: SessionName;
  city: string;
  /** Local opening and closing hour in the centre's own time. */
  openHour: number;
  closeHour: number;
  /** The centre's offset from UTC, in hours, at a given moment. */
  utcOffsetHours(time: number): number;
}

export const SESSIONS: readonly SessionDef[] = [
  { name: 'Asia', city: 'Tokyo', openHour: 9, closeHour: 18, utcOffsetHours: () => 9 },
  { name: 'London', city: 'London', openHour: 8, closeHour: 17, utcOffsetHours: (t) => (isEuropeanSummerTime(t) ? 1 : 0) },
  { name: 'New York', city: 'New York', openHour: 8, closeHour: 17, utcOffsetHours: (t) => newYorkOffsetSeconds(t) / 3600 },
];

export interface SessionHours {
  name: SessionName;
  city: string;
  /** Opening and closing hour in UTC, each 0-23.999; close may be less than open (wraps midnight). */
  openUtc: number;
  closeUtc: number;
}

const wrap24 = (h: number) => ((h % 24) + 24) % 24;

/** Each session's hours in UTC on the day containing `time`. */
export function sessionHoursUtc(time: number): SessionHours[] {
  return SESSIONS.map((s) => {
    const off = s.utcOffsetHours(time);
    return { name: s.name, city: s.city, openUtc: wrap24(s.openHour - off), closeUtc: wrap24(s.closeHour - off) };
  });
}

const within = (hour: number, open: number, close: number) => (open <= close ? hour >= open && hour < close : hour >= open || hour < close);

/** Sessions open at `time`. Empty on weekends (Saturday and Sunday UTC are treated as closed). */
export function sessionsOpenAt(time: number): SessionName[] {
  const d = new Date(time * 1000);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return sessionHoursUtc(time)
    .filter((s) => {
      if (!within(hour, s.openUtc, s.closeUtc)) return false;
      // Work out the centre's local weekday; sessions run Monday to Friday there.
      const def = SESSIONS.find((x) => x.name === s.name)!;
      const local = new Date((time + def.utcOffsetHours(time) * 3600) * 1000).getUTCDay();
      return local >= 1 && local <= 5;
    })
    .map((s) => s.name);
}

export interface HourlyProfile {
  /** Index 0-23 is the UTC hour. Average high-low range as a percentage of price; null for hours with no bars. */
  averageRangePercent: (number | null)[];
  /** Hourly bars that went into each average. */
  counts: number[];
  /** Days covered, from the first to the last bar used. */
  daysCovered: number;
}

/**
 * Average high-low range for each UTC hour of the day, over the `days`
 * days up to the last bar. Expects hourly bars with real ranges.
 */
export function hourlyRangeProfile(hourlyBars: readonly Bar[], days = 30): HourlyProfile {
  const sums = new Array<number>(24).fill(0);
  const counts = new Array<number>(24).fill(0);
  const last = hourlyBars[hourlyBars.length - 1];
  let first: number | null = null;
  if (last) {
    const from = last.time - days * 86400;
    for (const b of hourlyBars) {
      if (b.time <= from) continue;
      const hour = new Date(b.time * 1000).getUTCHours();
      sums[hour]! += ((b.high - b.low) / b.close) * 100;
      counts[hour]! += 1;
      first ??= b.time;
    }
  }
  return {
    averageRangePercent: sums.map((s, h) => (counts[h]! > 0 ? s / counts[h]! : null)),
    counts,
    daysCovered: last && first !== null ? Math.max(1, Math.ceil((last.time - first) / 86400)) : 0,
  };
}
