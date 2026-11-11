/**
 * The one place panels get data from. Panels never fetch or read files
 * themselves: they ask the hub and are told when something changed.
 *
 * Order of preference for bars: the user's imported files; then a cross
 * computed from the user's two dollar-pair files; then the shipped sample
 * set. If none has the request the answer is null and the panel shows an
 * empty state.
 */
import { FileImportAdapter, type ImportedSeries, type ImportResult } from './fileAdapter';
import { fileStore, type StoredFile } from './fileStore';
import { isFileZone, type FileZone } from './fileZone';
import { crossLegs, getDerivedCross } from './cross';
import { decodeText } from './mtCsv';
import { loadSamples, type SampleManifest } from './samples';
import type { DayRoll } from './aggregate';
import { TIMEFRAMES, type BarRequest, type BarSeries, type InstrumentId, type Timeframe } from './types';

export interface ImportOutcome {
  fileName: string;
  result?: ImportResult;
  error?: string;
  /** Set when the file imported but could not be saved for next time. */
  notSaved?: string;
}

export class DataHub {
  private readonly files = new FileImportAdapter();
  private readonly samples = new FileImportAdapter();
  private readonly listeners = new Set<() => void>();
  /** Crosses already computed for whole-series requests; emptied on any change. */
  private readonly derived = new Map<string, BarSeries | null>();
  sampleManifest: SampleManifest | null = null;
  /** Problems found while starting up, for the Files panel to show. */
  startupErrors: string[] = [];

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.derived.clear();
    this.listeners.forEach((fn) => fn());
  }

  setDayRoll(dayRoll: DayRoll): void {
    if (this.files.dayRoll === dayRoll) return;
    this.files.dayRoll = dayRoll;
    this.samples.dayRoll = dayRoll;
    this.changed();
  }

  /** Load the sample set and any files saved in this browser. */
  async start(): Promise<void> {
    try {
      const readText = async (path: string) => {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return res.text();
      };
      const { manifest } = await loadSamples(this.samples, readText);
      this.sampleManifest = manifest;
    } catch (err) {
      this.startupErrors.push(`Sample files could not be loaded: ${(err as Error).message}`);
    }
    try {
      for (const f of await fileStore.all()) {
        try {
          this.files.importText(f.fileName, f.text, { zone: isFileZone(f.zone) ? f.zone : 0, now: () => f.importedAt });
        } catch (err) {
          this.startupErrors.push(`Saved file ${f.fileName} could not be read: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.startupErrors.push(`Saved files are unavailable in this browser: ${(err as Error).message}`);
    }
    this.changed();
  }

  async importFiles(files: File[], zone: FileZone): Promise<ImportOutcome[]> {
    const outcomes: ImportOutcome[] = [];
    for (const file of files) {
      const outcome: ImportOutcome = { fileName: file.name };
      try {
        const text = decodeText(await file.arrayBuffer());
        const importedAt = Math.floor(Date.now() / 1000);
        outcome.result = this.files.importText(file.name, text, { zone, now: () => importedAt });
        const { instrument, barSeconds } = outcome.result.series;
        const stored: StoredFile = { id: `${instrument}|${barSeconds}`, fileName: file.name, text, zone, importedAt };
        try {
          await fileStore.put(stored);
        } catch (err) {
          outcome.notSaved = (err as Error).message;
        }
      } catch (err) {
        outcome.error = (err as Error).message;
      }
      outcomes.push(outcome);
    }
    this.changed();
    return outcomes;
  }

  async removeFile(series: ImportedSeries): Promise<void> {
    this.files.remove(series.instrument, series.barSeconds);
    try {
      await fileStore.remove(`${series.instrument}|${series.barSeconds}`);
    } catch {
      /* already gone from memory; storage will be retried on next import */
    }
    this.changed();
  }

  importedFiles(): ImportedSeries[] {
    return this.files.list();
  }

  sampleFiles(): ImportedSeries[] {
    return this.samples.list();
  }

  async getBars(req: BarRequest): Promise<BarSeries | null> {
    const direct = await this.files.getBars(req);
    if (direct) return direct;
    const whole = req.from === undefined && req.to === undefined;
    const cacheKey = `${req.instrument}|${req.timeframe}`;
    let derived = whole ? this.derived.get(cacheKey) : undefined;
    if (derived === undefined) {
      derived = await getDerivedCross(this.files, req);
      if (whole) this.derived.set(cacheKey, derived);
    }
    return derived ?? (await this.samples.getBars(req));
  }

  /** Timeframes that have data for an instrument, for the empty state. */
  availableTimeframes(instrument: InstrumentId): Timeframe[] {
    const out = new Set<Timeframe>();
    for (const adapter of [this.files, this.samples]) {
      for (const s of adapter.list()) {
        if (s.instrument !== instrument) continue;
        adapter.servedTimeframes(s).forEach((tf) => out.add(tf));
      }
    }
    const legs = crossLegs(instrument);
    if (legs) {
      const served = (id: InstrumentId) => new Set(this.files.list().filter((s) => s.instrument === id).flatMap((s) => this.files.servedTimeframes(s)));
      const base = served(legs.base.instrument);
      served(legs.quote.instrument).forEach((tf) => base.has(tf) && out.add(tf));
    }
    return TIMEFRAMES.filter((tf) => out.has(tf));
  }
}
