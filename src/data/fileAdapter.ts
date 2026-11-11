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
import { aggregateBars, type DayRoll } from './aggregate';
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

  /**
   * Bars for a chart timeframe. Uses a file of exactly that timeframe when
   * one is loaded; otherwise builds the bars from the closest finer file.
   * When built, `to` cuts the fine bars first, so the last coarse bar holds
   * nothing from after `to`. Replay relies on that.
   */
  async getBars(req: BarRequest): Promise<BarSeries | null> {
    const target = TIMEFRAME_SECONDS[req.timeframe];
    const from = req.from ?? -Infinity;
    const to = req.to ?? Infinity;

    const exact = this.store.get(key(req.instrument, target));
    let bars: Bar[];
    let source: SourceInfo;
    let asOf: number;
    if (exact) {
      bars = exact.bars.filter((b) => b.time >= from && b.time <= to);
      source = exact.source;
      asOf = bars.length > 0 ? bars[bars.length - 1]!.time : 0;
    } else {
      const base = this.list()
        .filter((s) => s.instrument === req.instrument && servedBy(s).includes(req.timeframe))
        .sort((x, y) => y.barSeconds - x.barSeconds)[0];
      if (!base) return null;
      const fine = to === Infinity ? base.bars : base.bars.filter((b) => b.time <= to);
      if (to === Infinity) {
        const cacheKey = `${key(req.instrument, target)}|${this.dayRoll}`;
        let whole = this.built.get(cacheKey);
        if (!whole) {
          whole = aggregateBars(fine, target, this.dayRoll);
          this.built.set(cacheKey, whole);
        }
        bars = from === -Infinity ? whole : whole.filter((b) => b.time >= from);
      } else {
        bars = aggregateBars(fine, target, this.dayRoll).filter((b) => b.time >= from);
      }
      source = { ...base.source, label: `${base.source.label} (built from ${base.timeframe} bars)` };
      asOf = fine.length > 0 ? fine[fine.length - 1]!.time : 0;
    }
    if (bars.length === 0) return null;
    return { instrument: req.instrument, timeframe: req.timeframe, bars, source: { ...source, asOf } };
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
