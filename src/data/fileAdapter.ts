/**
 * File import adapter: the source that must always work (spec section 7).
 * Holds parsed MetaTrader exports in memory and serves them through the
 * DataAdapter interface. Browser persistence is added in phase 1.
 */
import {
  type AdapterCapabilities,
  type BarRequest,
  type BarSeries,
  type DataAdapter,
  type InstrumentId,
  type SourceInfo,
  type Timeframe,
} from './types';
import { parseMtFilename, parseMtPriceCsv, MtCsvError, type ParsedPriceFile, type ParseOptions } from './mtCsv';

export interface ImportOptions extends ParseOptions {
  /** Override when the file name does not carry the symbol. */
  instrument?: InstrumentId;
  /** Override when neither the name nor the bar spacing gives a timeframe. */
  timeframe?: Timeframe;
  /** Extra SourceInfo fields, e.g. a note or `closeOnly` for sample sets. */
  source?: Partial<Pick<SourceInfo, 'label' | 'note' | 'closeOnly' | 'freshness'>>;
  /** Clock for `retrievedAt`; injectable so tests are deterministic. */
  now?: () => number;
}

export interface ImportResult {
  series: BarSeries;
  parsed: ParsedPriceFile;
}

const key = (instrument: InstrumentId, timeframe: Timeframe) => `${instrument}|${timeframe}`;

export class FileImportAdapter implements DataAdapter {
  readonly id = 'file';
  readonly label = 'Imported files';
  private readonly store = new Map<string, BarSeries>();

  /** Parse an export and add it. A later import of the same series replaces it. */
  importText(fileName: string, text: string, options: ImportOptions = {}): ImportResult {
    const parsed = parseMtPriceCsv(text, options);
    const fromName = parseMtFilename(fileName);
    const instrument = options.instrument ?? fromName.instrument;
    const timeframe = options.timeframe ?? fromName.timeframe ?? parsed.timeframe;
    if (!instrument) {
      throw new MtCsvError(`Cannot tell which instrument "${fileName}" holds. Rename it (e.g. XAUUSD_H1.csv) or choose one.`);
    }
    if (!timeframe) {
      throw new MtCsvError(`Cannot tell the timeframe of "${fileName}". Rename it (e.g. XAUUSD_H1.csv) or choose one.`);
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

    const series: BarSeries = { instrument, timeframe, bars: parsed.bars, source };
    this.store.set(key(instrument, timeframe), series);
    return { series, parsed };
  }

  capabilities(): AdapterCapabilities {
    const all = [...this.store.values()];
    return {
      instruments: [...new Set(all.map((s) => s.instrument))],
      timeframes: [...new Set(all.map((s) => s.timeframe))],
      quotes: false,
    };
  }

  list(): BarSeries[] {
    return [...this.store.values()];
  }

  async getBars(req: BarRequest): Promise<BarSeries | null> {
    const series = this.store.get(key(req.instrument, req.timeframe));
    if (!series) return null;
    const from = req.from ?? -Infinity;
    const to = req.to ?? Infinity;
    const bars = series.bars.filter((b) => b.time >= from && b.time <= to);
    if (bars.length === 0) return null;
    return { ...series, bars, source: { ...series.source, asOf: bars[bars.length - 1]!.time } };
  }

  clear(): void {
    this.store.clear();
  }
}
