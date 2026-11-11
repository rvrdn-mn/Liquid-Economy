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
import { clampReplay, stepReplay, type Extent } from '../app/replay';
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
  /** The moment being replayed, or null when showing the latest data. */
  replayTime: number | null = null;
  replayPlaying = false;
  /** Steps per second while playing. */
  replaySpeed = 2;
  private replayTimer: ReturnType<typeof setInterval> | null = null;

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

  // ------------------------------------------------------------- replay

  /** The time panels should treat as "now": the replay moment, or the real clock. */
  now(): number {
    return this.replayTime ?? Date.now() / 1000;
  }

  /** First and last moment covered by any loaded data. */
  extent(): Extent | null {
    const parts = [this.files.extent(), this.samples.extent()].filter((e): e is Extent => e !== null);
    if (parts.length === 0) return null;
    return { first: Math.min(...parts.map((e) => e.first)), last: Math.max(...parts.map((e) => e.last)) };
  }

  /** Go to a past moment, or back to the latest data with null. */
  setReplayTime(time: number | null): void {
    const extent = this.extent();
    const next = time === null || !extent ? null : clampReplay(time, extent);
    if (next === null) this.pauseReplay(false);
    if (next === this.replayTime) return;
    this.replayTime = next;
    this.changed();
  }

  /** Move by whole steps. Returns false when the end of the data stops it. */
  stepReplay(stepSeconds: number, count: number): boolean {
    const extent = this.extent();
    if (!extent || this.replayTime === null) return false;
    const { time, atEnd } = stepReplay(this.replayTime, stepSeconds, count, extent);
    const moved = time !== this.replayTime;
    this.replayTime = time;
    if (moved) this.changed();
    return moved && !(atEnd && count > 0);
  }

  /** Play forward, one step at a time. `stepSeconds` is read each tick so a timeframe change takes effect. */
  playReplay(stepSeconds: () => number): void {
    if (this.replayTime === null) return;
    this.pauseReplay(false);
    this.replayPlaying = true;
    this.replayTimer = setInterval(() => {
      // Do not run on a hidden tab: nobody is watching and it wastes the battery.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!this.stepReplay(stepSeconds(), 1)) this.pauseReplay();
    }, 1000 / this.replaySpeed);
    this.changed();
  }

  pauseReplay(notify = true): void {
    if (this.replayTimer !== null) clearInterval(this.replayTimer);
    this.replayTimer = null;
    const was = this.replayPlaying;
    this.replayPlaying = false;
    if (notify && was) this.changed();
  }

  setReplaySpeed(stepsPerSecond: number, stepSeconds: () => number): void {
    this.replaySpeed = stepsPerSecond;
    if (this.replayPlaying) this.playReplay(stepSeconds);
    else this.changed();
  }

  importedFiles(): ImportedSeries[] {
    return this.files.list();
  }

  sampleFiles(): ImportedSeries[] {
    return this.samples.list();
  }

  async getBars(req: BarRequest): Promise<BarSeries | null> {
    if (this.replayTime !== null && req.asOf === undefined) req = { ...req, asOf: this.replayTime };
    const direct = await this.files.getBars(req);
    if (direct) return direct;
    const whole = req.from === undefined && req.to === undefined && req.asOf === undefined;
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
