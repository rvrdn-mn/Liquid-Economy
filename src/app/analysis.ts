/**
 * Turns bars from the data layer into the numbers each panel shows.
 * No drawing here and no fetching: this module asks a BarSource for bars
 * and hands them to the pure calculation functions.
 *
 * One rule runs through it. Panels that compare instruments use a single
 * "as of" time: the earliest moment at which any of the instruments stops
 * having data. Comparing a pair that ends in October with one that ends in
 * November would otherwise look like a move.
 */
import { correlationLinks, isFlagged, type Link } from '../calc/correlation';
import { hourlyRangeProfile, type HourlyProfile } from '../calc/session';
import { pairOf, strengthAt, type StrengthResult } from '../calc/strength';
import { volatilityReading, type VolatilityReading } from '../calc/volatility';
import { FX_PAIRS } from '../data/instruments';
import {
  CURRENCIES,
  TIMEFRAME_SECONDS,
  type Bar,
  type BarRequest,
  type BarSeries,
  type Currency,
  type InstrumentId,
  type Timeframe,
} from '../data/types';

export interface BarSource {
  getBars(req: BarRequest): Promise<BarSeries | null>;
}

export interface Loaded {
  timeframe: Timeframe;
  barSeconds: number;
  series: Map<InstrumentId, BarSeries>;
  missing: InstrumentId[];
  /** End of the last bar every loaded instrument has; null when nothing loaded. */
  asOf: number | null;
  /** The instrument whose data ends first, when the others go on longer. */
  limitedBy: InstrumentId | null;
  /** Distinct source labels, for the panel footer. */
  sources: string[];
  /** True when any series is one value per bar with no range. */
  anyCloseOnly: boolean;
}

export async function loadMany(source: BarSource, instruments: readonly InstrumentId[], timeframe: Timeframe, to?: number): Promise<Loaded> {
  const barSeconds = TIMEFRAME_SECONDS[timeframe];
  const series = new Map<InstrumentId, BarSeries>();
  const missing: InstrumentId[] = [];
  const results = await Promise.all(instruments.map((instrument) => source.getBars({ instrument, timeframe, ...(to !== undefined ? { to } : {}) })));
  let asOf: number | null = null;
  let newest: number | null = null;
  let limitedBy: InstrumentId | null = null;
  results.forEach((s, i) => {
    const instrument = instruments[i]!;
    if (!s || s.bars.length === 0) {
      missing.push(instrument);
      return;
    }
    series.set(instrument, s);
    const end = s.bars[s.bars.length - 1]!.time + barSeconds;
    if (asOf === null || end < asOf) {
      asOf = end;
      limitedBy = instrument;
    }
    if (newest === null || end > newest) newest = end;
  });
  if (asOf === newest) limitedBy = null;
  const all = [...series.values()];
  return {
    timeframe,
    barSeconds,
    series,
    missing,
    asOf,
    limitedBy,
    sources: [...new Set(all.map((s) => s.source.label.replace(/^File: .*$/, 'Imported files').replace(/^Derived from .*$/, 'Crosses derived from imported files').replace(/ \(built from .*$/, '')))],
    anyCloseOnly: all.some((s) => s.source.closeOnly === true),
  };
}

const barsOf = (loaded: Loaded): Map<InstrumentId, readonly Bar[]> => new Map([...loaded.series].map(([k, v]) => [k, v.bars]));

// ---------------------------------------------------------------- strength

export interface StrengthView {
  loaded: Loaded;
  lookbackSeconds: number;
  /** Null when it cannot be computed; `reason` then says why. */
  now: StrengthResult | null;
  reason?: string;
  /** Score history per currency, oldest first, ending at `asOf`. */
  history: Record<Currency, (number | null)[]>;
  historyTimes: number[];
  /** The pair of the strongest and weakest currency. */
  spotlight: { pair: InstrumentId; strong: Currency; weak: Currency } | null;
}

export async function strengthView(source: BarSource, timeframe: Timeframe, lookbackHours: number, historyPoints = 40, to?: number): Promise<StrengthView> {
  const loaded = await loadMany(source, FX_PAIRS, timeframe, to);
  const lookbackSeconds = lookbackHours * 3600;
  const history = Object.fromEntries(CURRENCIES.map((c) => [c, [] as (number | null)[]])) as Record<Currency, (number | null)[]>;
  const view: StrengthView = { loaded, lookbackSeconds, now: null, history, historyTimes: [], spotlight: null };
  if (loaded.asOf === null) {
    view.reason = `No ${timeframe} data is loaded for any of the 28 pairs.`;
    return view;
  }
  if (lookbackSeconds < loaded.barSeconds) {
    view.reason = `A ${lookbackHours}-hour lookback is shorter than one ${timeframe} bar. Choose a longer lookback or a shorter timeframe.`;
    return view;
  }
  const bars = barsOf(loaded);
  const now = strengthAt(bars, loaded.barSeconds, loaded.asOf, lookbackSeconds);
  if (now.ranked.length === 0) {
    view.reason = `The loaded ${timeframe} data does not reach back ${lookbackHours} hours.`;
    return view;
  }
  view.now = now;

  // History: the same measure at each earlier bar end of the series that limits `asOf`.
  const reference = loaded.series.get(loaded.limitedBy ?? [...loaded.series.keys()][0]!)!.bars;
  const times = reference.map((b) => b.time + loaded.barSeconds).filter((t) => t <= loaded.asOf!).slice(-historyPoints);
  for (const t of times) {
    const past = strengthAt(bars, loaded.barSeconds, t, lookbackSeconds);
    for (const c of CURRENCIES) history[c].push(past.score[c]);
  }
  view.historyTimes = times;

  const strong = now.ranked[0]!;
  const weak = now.ranked[now.ranked.length - 1]!;
  const pair = strong !== weak ? pairOf(strong, weak, FX_PAIRS) : null;
  if (pair) view.spotlight = { pair, strong, weak };
  return view;
}

// -------------------------------------------------------------- volatility

export interface VolatilityRow {
  instrument: InstrumentId;
  reading: VolatilityReading;
  /** End of this instrument's last bar. */
  asOf: number;
  closeOnly: boolean;
}

export interface VolatilityView {
  loaded: Loaded;
  /** Most unusually active first. */
  rows: VolatilityRow[];
  /** Instruments with data but too little of it for a reading. */
  tooShort: InstrumentId[];
}

export async function volatilityView(source: BarSource, instruments: readonly InstrumentId[], timeframe: Timeframe, period: number, baselineDays: number, to?: number): Promise<VolatilityView> {
  const loaded = await loadMany(source, instruments, timeframe, to);
  const rows: VolatilityRow[] = [];
  const tooShort: InstrumentId[] = [];
  for (const [instrument, s] of loaded.series) {
    const reading = volatilityReading(s.bars, period, baselineDays);
    if (!reading) {
      tooShort.push(instrument);
      continue;
    }
    rows.push({ instrument, reading, asOf: s.bars[s.bars.length - 1]!.time + loaded.barSeconds, closeOnly: s.source.closeOnly === true });
  }
  rows.sort((a, b) => b.reading.ratio - a.reading.ratio);
  return { loaded, rows, tooShort };
}

// ------------------------------------------------------------ linked pairs

export interface LinksView {
  loaded: Loaded;
  instruments: InstrumentId[];
  links: Link[];
  /** Strongest link first. */
  flagged: Link[];
  window: number;
  threshold: number;
}

export async function linksView(source: BarSource, watchlist: readonly InstrumentId[], timeframe: Timeframe, window: number, threshold: number, to?: number): Promise<LinksView> {
  const loaded = await loadMany(source, watchlist, timeframe, to);
  // Cut every series at the shared "as of" so all cells cover the same stretch.
  const cut = new Map<InstrumentId, readonly Bar[]>();
  for (const [k, s] of loaded.series) cut.set(k, loaded.asOf === null ? s.bars : s.bars.filter((b) => b.time + loaded.barSeconds <= loaded.asOf!));
  const links = correlationLinks(cut, watchlist, window);
  const flagged = links.filter((l) => isFlagged(l.r, threshold)).sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!));
  return { loaded, instruments: [...watchlist], links, flagged, window, threshold };
}

// ------------------------------------------------------------------ session

export interface SessionView {
  instrument: InstrumentId;
  /** Null when there are no hourly candles with a real range. */
  profile: HourlyProfile | null;
  reason?: string;
  sourceLabel?: string;
  asOf?: number;
}

export async function sessionView(source: BarSource, instrument: InstrumentId, days: number, to?: number): Promise<SessionView> {
  const s = await source.getBars({ instrument, timeframe: 'H1', ...(to !== undefined ? { to } : {}) });
  if (!s || s.bars.length === 0) {
    return { instrument, profile: null, reason: `No hourly data for ${instrument}. The session profile needs an imported intraday file.` };
  }
  if (s.source.closeOnly) {
    return { instrument, profile: null, reason: `The data for ${instrument} has no high or low, so hourly ranges cannot be measured.` };
  }
  return { instrument, profile: hourlyRangeProfile(s.bars, days), sourceLabel: s.source.label, asOf: s.source.asOf };
}
