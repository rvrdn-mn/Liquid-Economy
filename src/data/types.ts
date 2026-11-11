/**
 * Data layer contracts.
 *
 * Three layers are kept apart (spec section 8):
 *   data adapters  ->  calculation functions  ->  panels
 * Panels never fetch. They receive BarSeries / Quote / DailySeries values
 * that always carry a SourceInfo, so every panel can show where its data
 * came from and how old it is.
 */

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Canonical instrument id: six letters, e.g. "EURUSD", "XAUUSD". */
export type InstrumentId = string;

export const TIMEFRAMES = ['M5', 'M15', 'H1', 'H4', 'D1'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  M5: 300,
  M15: 900,
  H1: 3600,
  H4: 14400,
  D1: 86400,
};

/** One candle. `time` is the bar's open time as UTC epoch seconds. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Tick volume when the source provides one. Never synthesised. */
  volume?: number;
}

/**
 * How fresh a source can ever be. Shown next to every number.
 *  - near-live : polled spot price, seconds to minutes old
 *  - daily     : one observation per day (reference rates, yields)
 *  - file      : whatever the user imported; age is the last bar's time
 */
export type Freshness = 'near-live' | 'daily' | 'file';

export interface SourceInfo {
  /** Adapter id, e.g. "file", "gold-api", "frankfurter". */
  adapter: string;
  /** Human label for the panel footer, e.g. "MT5 export: XAUUSD_H1.csv". */
  label: string;
  freshness: Freshness;
  /** UTC epoch seconds of the newest data point. Drives the age stamp. */
  asOf: number;
  /** UTC epoch seconds when the app obtained the data (fetch or import). */
  retrievedAt: number;
  /**
   * True when open/high/low/close are all the same single observation
   * (a daily reference rate). Range-based maths (ATR, session profile)
   * must not be shown for such a series.
   */
  closeOnly?: boolean;
  /** Anything the user should know: delay, licence, time-zone assumption. */
  note?: string;
  /** Set when the series was cut for replay: the moment being replayed. */
  replayAt?: number;
}

export interface BarSeries {
  instrument: InstrumentId;
  timeframe: Timeframe;
  /** Ascending by time, no duplicates. */
  bars: Bar[];
  source: SourceInfo;
}

export interface Quote {
  instrument: InstrumentId;
  price: number;
  /** UTC epoch seconds the provider says the price was updated. */
  time: number;
  source: SourceInfo;
}

/** A daily non-price series, e.g. US 10-year yield or a risk-mood index. */
export interface DailySeries {
  id: string;
  label: string;
  points: { time: number; value: number }[];
  source: SourceInfo;
}

export interface BarRequest {
  instrument: InstrumentId;
  timeframe: Timeframe;
  /** Inclusive UTC epoch seconds, compared with each bar's open time. */
  from?: number;
  to?: number;
  /**
   * Replay moment, UTC epoch seconds. Only what was known by then is
   * returned: bars built from finer files end with a part-formed bar that
   * holds nothing later; other bars are included only once finished.
   */
  asOf?: number;
}

export interface AdapterCapabilities {
  instruments: InstrumentId[];
  timeframes: Timeframe[];
  /** True when `getQuote` returns something fresher than the last bar. */
  quotes: boolean;
}

/**
 * The one interface every price source implements. Swapping a source means
 * writing another adapter; panels and calculations are untouched.
 *
 * Contract: an adapter returns `null` when it has no data for a request.
 * It never fabricates, interpolates or forward-fills prices.
 */
export interface DataAdapter {
  readonly id: string;
  readonly label: string;
  capabilities(): AdapterCapabilities;
  getBars(req: BarRequest): Promise<BarSeries | null>;
  getQuote?(instrument: InstrumentId): Promise<Quote | null>;
}

/** Sources of daily driver series (yield, risk mood) implement this. */
export interface DailySeriesAdapter {
  readonly id: string;
  readonly label: string;
  getDailySeries(id: string): Promise<DailySeries | null>;
}
