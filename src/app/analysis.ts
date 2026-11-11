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
import { driverLink, indexFromMoves, latestMove, levelInRange, linkDirection, type ChangeKind, type DriverLink, type LinkDirection, type Point } from '../calc/drivers';
import { hourlyRangeProfile, type HourlyProfile } from '../calc/session';
import { pairOf, strengthAt, type StrengthResult } from '../calc/strength';
import { currencyVolatility, scoreChange, stormLevel, type CurrencyWeather } from '../calc/weather';
import { volatilityReading, type VolatilityReading } from '../calc/volatility';
import { FX_PAIRS } from '../data/instruments';
import {
  CURRENCIES,
  TIMEFRAME_SECONDS,
  type Bar,
  type BarRequest,
  type BarSeries,
  type Currency,
  type DailySeries,
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
  /** True when the data was cut at a replay moment. */
  replay: boolean;
}

export async function loadMany(source: BarSource, instruments: readonly InstrumentId[], timeframe: Timeframe, to?: number): Promise<Loaded> {
  const barSeconds = TIMEFRAME_SECONDS[timeframe];
  const series = new Map<InstrumentId, BarSeries>();
  const missing: InstrumentId[] = [];
  const results = await Promise.all(instruments.map((instrument) => source.getBars({ instrument, timeframe, ...(to !== undefined ? { to } : {}) })));
  let asOf: number | null = null;
  let newest: number | null = null;
  let limitedBy: InstrumentId | null = null;
  results.forEach((found, i) => {
    const instrument = instruments[i]!;
    let s = found;
    if (s && s.source.replayAt !== undefined) {
      // Comparisons use finished bars only; the part-formed bar is for the chart.
      const replayAt = s.source.replayAt;
      const finished = s.bars.filter((b) => b.time + barSeconds <= replayAt);
      s = finished.length === s.bars.length ? s : { ...s, bars: finished };
    }
    if (!s || s.bars.length === 0) {
      missing.push(instrument);
      return;
    }
    series.set(instrument, s);
    // In replay, nothing is known past the replay moment, even mid-bar.
    const end = Math.min(s.bars[s.bars.length - 1]!.time + barSeconds, s.source.replayAt ?? Infinity);
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
    replay: all.some((s) => s.source.replayAt !== undefined),
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
    rows.push({ instrument, reading, asOf: Math.min(s.bars[s.bars.length - 1]!.time + loaded.barSeconds, s.source.replayAt ?? Infinity), closeOnly: s.source.closeOnly === true });
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

// ------------------------------------------------------------------ weather

export interface WeatherView {
  strength: StrengthView;
  /** One entry per currency, strongest first; empty when strength cannot be computed. */
  currencies: CurrencyWeather[];
  /** Bars the wind looks back over. */
  windBars: number;
  /** Pairs that had a volatility reading. */
  volatilityPairs: number;
}

/** Bars of strength history the wind is measured over. */
export const WIND_BARS = 6;

export async function weatherView(source: BarSource, timeframe: Timeframe, lookbackHours: number, atrPeriod: number, baselineDays: number, windBars = WIND_BARS): Promise<WeatherView> {
  const [strength, volatility] = await Promise.all([
    strengthView(source, timeframe, lookbackHours, Math.max(40, windBars + 1)),
    volatilityView(source, FX_PAIRS, timeframe, atrPeriod, baselineDays),
  ]);
  const view: WeatherView = { strength, currencies: [], windBars, volatilityPairs: volatility.rows.length };
  if (!strength.now) return view;
  const storm = currencyVolatility(new Map(volatility.rows.map((r) => [r.instrument, r.reading.ratio])));
  view.currencies = strength.now.ranked.map((currency) => ({
    currency,
    pressure: strength.now!.score[currency],
    wind: scoreChange(strength.history[currency], windBars),
    storm: storm[currency],
    level: stormLevel(storm[currency]),
  }));
  return view;
}

// ------------------------------------------------------------- gold drivers

export type DriverId = 'dollar' | 'yield' | 'risk';

export interface DriverSource extends BarSource {
  /** Bars with at least `minBars` of history where any source can give them. */
  getLongBars?(req: BarRequest, minBars: number): Promise<BarSeries | null>;
  getDailySeries(id: 'yield' | 'risk'): Promise<DailySeries | null>;
}

export interface DriverRow {
  id: DriverId;
  label: string;
  /** How the value is written: '%' for a yield, '' for an index. */
  unit: string;
  kind: ChangeKind;
  /** False when there is no data for this driver; `reason` says what to do. */
  available: boolean;
  reason?: string;
  latest: { value: number; change: number; time: number } | null;
  /** Where the latest value sits in its range over the window: 0 low, 1 high. */
  level: number | null;
  link: DriverLink | null;
  direction: LinkDirection;
  sourceLabel?: string;
  note?: string;
}

export interface DriversView {
  window: number;
  gold: { latest: { value: number; change: number; time: number } | null; level: number | null; sourceLabel: string; closeOnly: boolean; days: number } | null;
  rows: DriverRow[];
  /** Why nothing can be shown, when gold itself has no daily data. */
  reason?: string;
  replay: boolean;
}

const USD_PAIRS = FX_PAIRS.filter((p) => p.includes('USD'));

/** Finished daily bars as dated points. */
function dailyPoints(series: BarSeries): Point[] {
  const replayAt = series.source.replayAt;
  const bars = replayAt === undefined ? series.bars : series.bars.filter((b) => b.time + 86400 <= replayAt);
  return bars.map((b) => ({ time: b.time, value: b.close }));
}

/**
 * The dollar driver: the app's own dollar strength. Each day's value is
 * the dollar's average move against the other majors that day (the number
 * behind the strength score, with a one-day lookback), compounded into an
 * index that starts at 100. No extra feed is needed.
 */
async function dollarIndex(source: DriverSource, minBars: number): Promise<{ points: Point[]; pairs: number; sources: string[]; replay: boolean }> {
  const long: BarSource = { getBars: (req) => (source.getLongBars ? source.getLongBars(req, minBars) : source.getBars(req)) };
  const loaded = await loadMany(long, USD_PAIRS, 'D1');
  if (loaded.asOf === null) return { points: [], pairs: 0, sources: [], replay: loaded.replay };
  const bars = new Map([...loaded.series].map(([k, v]) => [k, v.bars as readonly Bar[]]));
  const reference = loaded.series.get(loaded.limitedBy ?? [...loaded.series.keys()][0]!)!.bars;
  const moves: { time: number; percent: number }[] = [];
  for (const bar of reference) {
    const end = bar.time + 86400;
    if (end > loaded.asOf) break;
    const s = strengthAt(bars, 86400, end, 86400);
    // Only days on which every loaded dollar pair has a move, so the index is one consistent basket.
    if (s.average.USD === null || s.pairsUsed.USD !== loaded.series.size) continue;
    moves.push({ time: bar.time, percent: s.average.USD });
  }
  return { points: indexFromMoves(moves), pairs: loaded.series.size, sources: loaded.sources, replay: loaded.replay };
}

export async function driversView(source: DriverSource, window: number): Promise<DriversView> {
  const minBars = window + 3;
  const goldReq: BarRequest = { instrument: 'XAUUSD', timeframe: 'D1' };
  const [goldSeries, dollar, yields, risk] = await Promise.all([
    source.getLongBars ? source.getLongBars(goldReq, minBars) : source.getBars(goldReq),
    dollarIndex(source, minBars),
    source.getDailySeries('yield'),
    source.getDailySeries('risk'),
  ]);
  const replay = goldSeries?.source.replayAt !== undefined || dollar.replay || yields?.source.replayAt !== undefined;
  if (!goldSeries) {
    return { window, gold: null, rows: [], reason: 'No daily gold data is loaded, so there is nothing to compare the drivers with.', replay };
  }
  const gold = dailyPoints(goldSeries);

  const row = (id: DriverId, label: string, unit: string, kind: ChangeKind, points: Point[] | null, sourceLabel: string | undefined, missing: string, note?: string): DriverRow => {
    // One shared "as of" day: a driver's later values are left out until gold has that day too.
    const lastGold = gold[gold.length - 1]?.time ?? -Infinity;
    points = points ? points.filter((p) => p.time <= lastGold) : null;
    if (!points || points.length < 2) {
      return { id, label, unit, kind, available: false, reason: missing, latest: null, level: null, link: null, direction: 'none' };
    }
    const link = driverLink(gold, points, kind, window);
    const out: DriverRow = { id, label, unit, kind, available: true, latest: latestMove(points, kind), level: levelInRange(points, window), link, direction: linkDirection(link.r) };
    if (sourceLabel !== undefined) out.sourceLabel = sourceLabel;
    if (note !== undefined) out.note = note;
    return out;
  };

  const dollarNote = dollar.pairs > 0 && dollar.pairs < USD_PAIRS.length ? `Based on ${dollar.pairs} of the 7 dollar pairs.` : undefined;
  const rows: DriverRow[] = [
    row('dollar', 'US dollar', '', 'percent', dollar.points, dollar.sources.join(' + ') || undefined, 'No daily data for the dollar pairs is loaded.', dollarNote),
    row('yield', yields?.label ?? 'US 10-year Treasury yield', '%', 'difference', yields?.points ?? null, yields?.source.label, 'The yield data could not be loaded.', yields?.source.note),
    row('risk', risk?.label ?? 'Risk mood', '', 'percent', risk?.points ?? null, risk?.source.label, 'No risk-mood data. Import a daily "date, value" file, such as a volatility index history, in the Files panel.'),
  ];
  return {
    window,
    gold: { latest: latestMove(gold, 'percent'), level: levelInRange(gold, window), sourceLabel: goldSeries.source.label, closeOnly: goldSeries.source.closeOnly === true, days: gold.length },
    rows,
    replay,
  };
}
