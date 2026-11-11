/**
 * Journal statistics (spec section 6): win rate, average win, average
 * loss, profit factor, and results by session and by day of week. Pure.
 *
 * Only closed trades with a known result are counted. A trade's result is
 * its profit plus any commission and swap the file lists.
 */
import type { InstrumentId } from '../data/types';
import { sessionsOpenAt } from './session';

export interface Trade {
  id: string;
  /** Symbol as written in the file. */
  symbol: string;
  /** The app's instrument, when the symbol is one it knows. */
  instrument: InstrumentId | null;
  side: 'buy' | 'sell';
  volume: number | null;
  openTime: number;
  openPrice: number;
  closeTime: number | null;
  closePrice: number | null;
  /** Result in account currency, costs included; null for a trade still open. */
  result: number | null;
}

export interface Tally {
  trades: number;
  wins: number;
  losses: number;
  net: number;
}

export interface JournalStats extends Tally {
  breakeven: number;
  /** Wins as a share of all counted trades, 0..1; null with no trades. */
  winRate: number | null;
  /** Mean of the winning results; null with no wins. */
  averageWin: number | null;
  /** Mean of the losing results, a negative number; null with no losses. */
  averageLoss: number | null;
  /** Total won divided by total lost; null when nothing was lost (it has no value then). */
  profitFactor: number | null;
  grossProfit: number;
  grossLoss: number;
  bySession: { label: string; tally: Tally }[];
  /** Index 0 is Sunday. */
  byWeekday: Tally[];
}

const emptyTally = (): Tally => ({ trades: 0, wins: 0, losses: 0, net: 0 });

function add(tally: Tally, result: number): void {
  tally.trades += 1;
  tally.net += result;
  if (result > 0) tally.wins += 1;
  else if (result < 0) tally.losses += 1;
}

export const SESSION_ORDER = ['Asia', 'Asia + London', 'London', 'London + New York', 'New York', 'Outside sessions'] as const;

/** Which session a moment falls in; overlaps are their own bucket. */
export function sessionLabel(time: number): (typeof SESSION_ORDER)[number] {
  const open = sessionsOpenAt(time);
  if (open.length === 0) return 'Outside sessions';
  const label = open.join(' + ');
  return (SESSION_ORDER as readonly string[]).includes(label) ? (label as (typeof SESSION_ORDER)[number]) : 'Outside sessions';
}

/**
 * Statistics over closed trades. Session and weekday are taken from the
 * time the trade was opened. `weekdayOf` lets the caller choose the clock
 * (the display zone); it defaults to UTC.
 */
export function journalStats(trades: readonly Trade[], weekdayOf: (time: number) => number = (t) => new Date(t * 1000).getUTCDay()): JournalStats {
  const total = emptyTally();
  let breakeven = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const sessions = new Map<string, Tally>(SESSION_ORDER.map((s) => [s, emptyTally()]));
  const weekdays = Array.from({ length: 7 }, emptyTally);
  for (const t of trades) {
    if (t.result === null || t.closeTime === null || !Number.isFinite(t.result)) continue;
    add(total, t.result);
    if (t.result > 0) grossProfit += t.result;
    else if (t.result < 0) grossLoss += -t.result;
    else breakeven += 1;
    add(sessions.get(sessionLabel(t.openTime))!, t.result);
    add(weekdays[weekdayOf(t.openTime)]!, t.result);
  }
  return {
    ...total,
    breakeven,
    winRate: total.trades > 0 ? total.wins / total.trades : null,
    averageWin: total.wins > 0 ? grossProfit / total.wins : null,
    averageLoss: total.losses > 0 ? -grossLoss / total.losses : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    grossProfit,
    grossLoss,
    bySession: SESSION_ORDER.map((label) => ({ label, tally: sessions.get(label)! })).filter((s) => s.tally.trades > 0),
    byWeekday: weekdays,
  };
}
