/**
 * File import adapter: the source that must always work (spec section 7).
 * Holds parsed price files in memory and serves them through the
 * DataAdapter interface. Browser persistence is added in phase 1.
 *
 * A file of fine bars also serves every coarser timeframe: one-minute
 * files give M5 to D1, an H1 file gives H4 and D1. Coarser bars are built
 * on request and never stored as if they had been imported.
 */
import {
  TIMEFRAME_SECONDS,
  TIMEFRAMES,
  type AdapterCapabilities,
  type Bar,
  type BarRequest,
  type BarSeries,
  type DataAdapter,
  type InstrumentId,
  type SourceInfo,
  type Timeframe,
} from './types';
import { aggregateBars, countUpTo, windowStart, type DayRoll } from './aggregate';
import { parseMtFilename, parseMtPriceCsv, MtCsvError, type ParsedPriceFile, type ParseOptions } from './mtCsv';

/** One-minute files are accepted as a source but are not a chart timeframe. */
export type FileTimeframe = Timeframe | 'M1';

const FILE_TIMEFRAME_SECONDS: Record<FileTimeframe, number> = { M1: 60, ...TIMEFRAME_SECONDS };

const labelFor = (seconds: number): FileTimeframe | null =>
  (Object.keys(FILE_TIMEFRAME_SECONDS) as FileTimeframe[]).find((k) => FILE_TIMEFRAME_SECONDS[k] === seconds) ?? null;

export interface ImportOptions extends ParseOptions {
  /** Override when the file name does not carry the symbol. */
  instrument?: InstrumentId;
  /** Override when neither the name nor the bar spacing gives a period. */
  timeframe?: FileTimeframe;
  /** Extra SourceInfo fields, e.g. a note or `closeOnly` for sample sets. */
  source?: Partial<Pick<SourceInfo, 'label' | 'note' | 'closeOnly' | 'freshness'>>;
  /** Clock for `retrievedAt`; injectable so tests are deterministic. */
  now?: () => number;
}

/** A file as imported, before any building of coarser bars. */
export interface ImportedSeries {
  instrument: InstrumentId;
  timeframe: FileTimeframe;
  barSeconds: number;
  bars: Bar[];
  source: SourceInfo;
}

export interface ImportResult {
  series: ImportedSeries;
  parsed: ParsedPriceFile;
  /** Chart timeframes this file can serve, itself included. */
  serves: Timeframe[];
}

const key = (instrument: InstrumentId, barSeconds: number) => `${instrument}|${barSeconds}`;

const servedBy = (series: ImportedSeries): Timeframe[] =>
  TIMEFRAMES.filter((tf) => {
    const target = TIMEFRAME_SECONDS[tf];
    if (target === series.barSeconds) return true;
    // A close-only series has no real range to combine into a bigger bar.
    return !series.source.closeOnly && target > series.barSeconds && target % series.barSeconds === 0;
  });

export class FileImportAdapter implements DataAdapter {
  readonly id = 'file';
  readonly label = 'Imported files';
  private readonly store = new Map<string, ImportedSeries>();
  /** Built bars, so that many panels asking for the same series build it once. */
  private readonly built = new Map<string, Bar[]>();
  /** Where built four-hour and daily bars begin. A setting. */
  dayRoll: DayRoll = 'ny17';

  /** Parse a price file and add it. A later import of the same series replaces it. */
  importText(fileName: string, text: string, options: ImportOptions = {}): ImportResult {
    const parsed = parseMtPriceCsv(text, options);
    const fromName = parseMtFilename(fileName);
    const instrument = options.instrument ?? fromName.instrument;
    if (!instrument) {
      throw new MtCsvError(`Cannot tell which instrument "${fileName}" holds. Rename it (e.g. XAUUSD_H1.csv) or choose one.`);
    }
    const barSeconds = options.timeframe
      ? FILE_TIMEFRAME_SECONDS[options.timeframe]
      : (fromName.barSeconds ?? parsed.barSeconds);
    const timeframe = barSeconds === null ? null : labelFor(barSeconds);
    if (barSeconds === null || timeframe === null) {
      throw new MtCsvError(
        `Cannot tell the timeframe of "${fileName}". Rename it (e.g. XAUUSD_H1.csv) or choose one. Supported: M1, M5, M15, H1, H4, D1.`,
      );
    }

    const last = parsed.bars[parsed.bars.length - 1]!;
    const now = options.now ?? (() => Math.floor(Date.now() / 1000));
    const source: SourceInfo = {
      adapter: this.id,
      label: options.source?.label ?? `File: ${fileName}`,
      freshness: options.source?.freshness ?? 'file',
      asOf: last.time,
      retrievedAt: now(),
    };
    if (options.source?.closeOnly) source.closeOnly = true;
    if (options.source?.note) source.note = options.source.note;

    const series: ImportedSeries = { instrument, timeframe, barSeconds, bars: parsed.bars, source };
    this.store.set(key(instrument, barSeconds), series);
    this.built.clear();
    return { series, parsed, serves: servedBy(series) };
  }

  capabilities(): AdapterCapabilities {
    const all = this.list();
    const served = new Set(all.flatMap(servedBy));
    return {
      instruments: [...new Set(all.map((s) => s.instrument))],
      timeframes: TIMEFRAMES.filter((tf) => served.has(tf)),
      quotes: false,
    };
  }

  /** Chart timeframes one imported file can serve. */
  servedTimeframes(series: ImportedSeries): Timeframe[] {
    return servedBy(series);
  }

  /** The files as imported. */
  list(): ImportedSeries[] {
    return [...this.store.values()];
  }

  /** The closest finer file that can be combined into `target`-second bars. */
  private finerBase(instrument: InstrumentId, target: number): ImportedSeries | undefined {
    return this.list()
      .filter((s) => s.instrument === instrument && s.barSeconds < target && target % s.barSeconds === 0 && !s.source.closeOnly)
      .sort((x, y) => y.barSeconds - x.barSeconds)[0];
  }

  /** All coarse bars built from a finer file, built once and reused. */
  private builtWhole(base: ImportedSeries, target: number): Bar[] {
    const cacheKey = `${key(base.instrument, target)}|${base.barSeconds}|${this.dayRoll}`;
    let whole = this.built.get(cacheKey);
    if (!whole) {
      whole = aggregateBars(base.bars, target, this.dayRoll);
      this.built.set(cacheKey, whole);
    }
    return whole;
  }

  /**
   * Coarse bars as they stood at `asOf`: every finished bar, then one
   * part-formed bar made only of fine bars that had finished by then.
   */
  private builtAsOf(base: ImportedSeries, target: number, asOf: number): { bars: Bar[]; lastFine: number } | null {
    const known = countUpTo(base.bars, asOf - base.barSeconds);
    if (known === 0) return null;
    const lastFine = base.bars[known - 1]!.time;
    const open = windowStart(lastFine, target, this.dayRoll);
    let first = known - 1;
    while (first > 0 && windowStart(base.bars[first - 1]!.time, target, this.dayRoll) === open) first--;
    const whole = this.builtWhole(base, target);
    const finished = whole.slice(0, countUpTo(whole, open - 1));
    return { bars: finished.concat(aggregateBars(base.bars.slice(first, known), target, this.dayRoll)), lastFine };
  }

  /**
   * Bars for a chart timeframe. Uses a file of exactly that timeframe when
   * one is loaded; otherwise builds the bars from the closest finer file.
   *
   * With `asOf` (replay) nothing later than that moment is used. A finer
   * file is preferred then, because it gives a true part-formed last bar;
   * without one, only bars that had finished by `asOf` are returned.
   */
  async getBars(req: BarRequest): Promise<BarSeries | null> {
    const target = TIMEFRAME_SECONDS[req.timeframe];
    const from = req.from ?? -Infinity;
    const to = req.to ?? Infinity;
    const exact = this.store.get(key(req.instrument, target));
    const base = this.finerBase(req.instrument, target);

    let bars: Bar[];
    let source: SourceInfo;
    let asOf: number;
    if (req.asOf !== undefined && base) {
      const cut = this.builtAsOf(base, target, req.asOf);
      if (!cut) return null;
      bars = cut.bars;
      source = { ...base.source, label: `${base.source.label} (built from ${base.timeframe} bars)` };
      asOf = cut.lastFine;
    } else if (exact) {
      bars = req.asOf === undefined ? exact.bars : exact.bars.slice(0, countUpTo(exact.bars, req.asOf - target));
      source = exact.source;
      asOf = bars.length > 0 ? bars[bars.length - 1]!.time : 0;
    } else if (base) {
      bars = this.builtWhole(base, target);
      source = { ...base.source, label: `${base.source.label} (built from ${base.timeframe} bars)` };
      asOf = base.bars[base.bars.length - 1]!.time;
    } else {
      return null;
    }

    if (from !== -Infinity || to !== Infinity) {
      if (to !== Infinity && !exact && base && req.asOf === undefined) {
        // Cut the fine bars first so the last coarse bar holds nothing after `to`.
        const fine = base.bars.slice(0, countUpTo(base.bars, to));
        bars = aggregateBars(fine, target, this.dayRoll);
        asOf = fine.length > 0 ? fine[fine.length - 1]!.time : 0;
      }
      bars = bars.filter((b) => b.time >= from && b.time <= to);
      if (exact && bars.length > 0) asOf = bars[bars.length - 1]!.time;
    }
    if (bars.length === 0) return null;
    const out: SourceInfo = { ...source, asOf };
    if (req.asOf !== undefined) out.replayAt = req.asOf;
    return { instrument: req.instrument, timeframe: req.timeframe, bars, source: out };
  }

  /** First and last bar time across everything imported; null when empty. */
  extent(): { first: number; last: number } | null {
    let first = Infinity;
    let last = -Infinity;
    for (const s of this.store.values()) {
      first = Math.min(first, s.bars[0]!.time);
      last = Math.max(last, s.bars[s.bars.length - 1]!.time + s.barSeconds);
    }
    return first === Infinity ? null : { first, last };
  }

  remove(instrument: InstrumentId, barSeconds: number): boolean {
    this.built.clear();
    return this.store.delete(key(instrument, barSeconds));
  }

  clear(): void {
    this.built.clear();
    this.store.clear();
  }
}
