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
import { parseDailyCsv, parseTreasuryYields, treasuryUrl } from './dailyCsv';
import { decodeText } from './mtCsv';
import { loadSamples, type SampleManifest } from './samples';
import { parseTradeHistory } from './tradeHistory';
import type { Trade } from '../calc/journal';
import type { DayRoll } from './aggregate';
import { clampReplay, stepReplay, type Extent } from '../app/replay';
import { TIMEFRAMES, type BarRequest, type BarSeries, type DailySeries, type InstrumentId, type Timeframe } from './types';

export interface ImportOutcome {
  fileName: string;
  result?: ImportResult;
  error?: string;
  /** Set when the file imported but could not be saved for next time. */
  notSaved?: string;
}

export type DriverId = 'yield' | 'risk';

export interface Journal {
  trades: Trade[];
  label: string;
  /** True for the invented example trades that ship with the app. */
  demo: boolean;
  note?: string;
  /** Rows of the file that were not trades or could not be read. */
  skipped: number;
}

const JOURNAL_FILE_ID = 'journal';

const RISK_FILE_ID = 'driver|risk';
const YIELD_CACHE_KEY = 'lmd.us10y.v1';
const YIELD_CACHE_SECONDS = 6 * 3600;

interface DriverManifest {
  yield?: { path: string; label: string; source: string; retrievedAt: string };
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
  /** Daily driver series that are not prices: the 10-year yield and a risk-mood measure. */
  private readonly drivers = new Map<DriverId, DailySeries>();
  /** The trade history in use: the user's own, or the demo until they import one. */
  journal: Journal | null = null;
  private demoJournal: Journal | null = null;

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
    await this.loadSavedYield();
    await this.loadDemoJournal();
    try {
      for (const f of await fileStore.all()) {
        if (f.kind === 'journal') {
          try {
            const parsed = parseTradeHistory(f.text, isFileZone(f.zone) ? f.zone : 0);
            this.journal = { trades: parsed.trades, label: f.fileName, demo: false, skipped: parsed.skipped };
          } catch (err) {
            this.startupErrors.push(`Saved trade history ${f.fileName} could not be read: ${(err as Error).message}`);
          }
          continue;
        }
        if (f.kind === 'driver') {
          try {
            if (f.id === RISK_FILE_ID) this.setRiskSeries(f.fileName, f.text, f.importedAt);
          } catch (err) {
            this.startupErrors.push(`Saved driver file ${f.fileName} could not be read: ${(err as Error).message}`);
          }
          continue;
        }
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
    void this.refreshYield();
  }

  // ------------------------------------------------------------ journal

  private async loadDemoJournal(): Promise<void> {
    try {
      const res = await fetch('samples/journal/manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = (await res.json()) as { path: string; label: string; note: string; utcOffsetMinutes: number };
      const csv = await fetch(`samples/journal/${manifest.path}`);
      if (!csv.ok) throw new Error(`HTTP ${csv.status}`);
      const parsed = parseTradeHistory(await csv.text(), manifest.utcOffsetMinutes);
      this.demoJournal = { trades: parsed.trades, label: manifest.label, demo: true, note: manifest.note, skipped: parsed.skipped };
      this.journal ??= this.demoJournal;
    } catch (err) {
      this.startupErrors.push(`The demo journal could not be loaded: ${(err as Error).message}`);
    }
  }

  /** Replace the journal with the user's own history. Throws with a plain reason if unreadable. */
  async importJournal(file: File, zone: FileZone): Promise<{ journal: Journal; notSaved?: string }> {
    const text = decodeText(await file.arrayBuffer());
    const parsed = parseTradeHistory(text, zone);
    const journal: Journal = { trades: parsed.trades, label: file.name, demo: false, skipped: parsed.skipped };
    this.journal = journal;
    let notSaved: string | undefined;
    try {
      await fileStore.put({ id: JOURNAL_FILE_ID, kind: 'journal', fileName: file.name, text, zone, importedAt: Math.floor(Date.now() / 1000) });
    } catch (err) {
      notSaved = (err as Error).message;
    }
    this.changed();
    return notSaved === undefined ? { journal } : { journal, notSaved };
  }

  /** Drop the user's history and go back to the demo trades. */
  async removeJournal(): Promise<void> {
    this.journal = this.demoJournal;
    try {
      await fileStore.remove(JOURNAL_FILE_ID);
    } catch {
      /* gone from memory either way */
    }
    this.changed();
  }

  /**
   * Trades as known at the current moment. In replay, trades opened later
   * are left out, and a trade still running at the replay moment is shown
   * as open, without its eventual exit or result.
   */
  getTrades(instrument?: InstrumentId): Trade[] {
    let trades = this.journal?.trades ?? [];
    if (instrument) trades = trades.filter((t) => t.instrument === instrument);
    const at = this.replayTime;
    if (at === null) return trades;
    return trades
      .filter((t) => t.openTime <= at)
      .map((t) => (t.closeTime !== null && t.closeTime > at ? { ...t, closeTime: null, closePrice: null, result: null } : t));
  }

  // ------------------------------------------------------------ drivers

  /** The yield snapshot shipped with the app, so the drivers work with no network. */
  private async loadSavedYield(): Promise<void> {
    try {
      const res = await fetch('samples/drivers/manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = (await res.json()) as DriverManifest;
      if (!manifest.yield) return;
      const csv = await fetch(`samples/drivers/${manifest.yield.path}`);
      if (!csv.ok) throw new Error(`HTTP ${csv.status}`);
      const { points } = parseDailyCsv(await csv.text());
      const saved = Math.floor(Date.parse(manifest.yield.retrievedAt) / 1000);
      this.drivers.set('yield', {
        id: 'yield',
        label: manifest.yield.label,
        points,
        source: { adapter: 'sample', label: manifest.yield.source, freshness: 'file', asOf: points[points.length - 1]!.time, retrievedAt: saved },
      });
    } catch (err) {
      this.startupErrors.push(`The saved yield data could not be loaded: ${(err as Error).message}`);
    }
  }

  /**
   * Ask the US Treasury for the current and previous year. Kept for six
   * hours in the browser so a refresh does not ask again. If the request
   * fails the saved copy stays in use and its label says so.
   */
  private async refreshYield(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const live = (points: DailySeries['points'], retrievedAt: number): DailySeries => ({
      id: 'yield',
      label: 'US 10-year Treasury yield',
      points,
      source: { adapter: 'treasury', label: 'US Treasury daily par yield curve', freshness: 'daily', asOf: points[points.length - 1]!.time, retrievedAt },
    });
    try {
      const cached = JSON.parse(localStorage.getItem(YIELD_CACHE_KEY) ?? 'null') as { fetchedAt: number; points: DailySeries['points'] } | null;
      if (cached && now - cached.fetchedAt < YIELD_CACHE_SECONDS && cached.points.length > 0) {
        this.drivers.set('yield', live(cached.points, cached.fetchedAt));
        this.changed();
        return;
      }
    } catch {
      /* no usable cache */
    }
    try {
      const year = new Date().getUTCFullYear();
      const texts = await Promise.all(
        [year - 1, year].map(async (y) => {
          const res = await fetch(treasuryUrl(y));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        }),
      );
      const byTime = new Map<number, number>();
      for (const text of texts) for (const p of parseTreasuryYields(text).points) byTime.set(p.time, p.value);
      const points = [...byTime].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time);
      if (points.length === 0) throw new Error('empty');
      this.drivers.set('yield', live(points, now));
      try {
        localStorage.setItem(YIELD_CACHE_KEY, JSON.stringify({ fetchedAt: now, points }));
      } catch {
        /* storage blocked: fetch again next time */
      }
      this.changed();
    } catch {
      const saved = this.drivers.get('yield');
      if (saved) saved.source.note = 'The Treasury could not be reached, so this is the copy saved with the app.';
      this.changed();
    }
  }

  private setRiskSeries(fileName: string, text: string, importedAt: number): DailySeries {
    const { points } = parseDailyCsv(text);
    const series: DailySeries = {
      id: 'risk',
      label: `Risk mood (${fileName})`,
      points,
      source: { adapter: 'file', label: `File: ${fileName}`, freshness: 'file', asOf: points[points.length - 1]!.time, retrievedAt: importedAt },
    };
    this.drivers.set('risk', series);
    return series;
  }

  /** Load a risk-mood file (a "date, value" CSV such as an index history). Throws with a plain reason if unreadable. */
  async importRiskFile(file: File): Promise<{ series: DailySeries; notSaved?: string }> {
    const text = decodeText(await file.arrayBuffer());
    const importedAt = Math.floor(Date.now() / 1000);
    const series = this.setRiskSeries(file.name, text, importedAt);
    let notSaved: string | undefined;
    try {
      await fileStore.put({ id: RISK_FILE_ID, kind: 'driver', fileName: file.name, text, zone: 0, importedAt });
    } catch (err) {
      notSaved = (err as Error).message;
    }
    this.changed();
    return notSaved === undefined ? { series } : { series, notSaved };
  }

  async removeRiskFile(): Promise<void> {
    this.drivers.delete('risk');
    try {
      await fileStore.remove(RISK_FILE_ID);
    } catch {
      /* gone from memory either way */
    }
    this.changed();
  }

  /** What is loaded for a driver, ignoring replay; for the Files panel. */
  driverInfo(id: DriverId): DailySeries | null {
    return this.drivers.get(id) ?? null;
  }

  /**
   * A driver's daily series. In replay, a day's value is included once that
   * day is over (UTC), which is after it was published.
   */
  async getDailySeries(id: DriverId): Promise<DailySeries | null> {
    const series = this.drivers.get(id);
    if (!series) return null;
    if (this.replayTime === null) return series;
    const replayAt = this.replayTime;
    const points = series.points.filter((p) => p.time + 86400 <= replayAt);
    if (points.length === 0) return null;
    return { ...series, points, source: { ...series.source, asOf: points[points.length - 1]!.time, replayAt } };
  }

  /**
   * Bars for calculations that need a minimum history. The usual choice is
   * used when it is long enough; otherwise the sample set is used if it is
   * longer. A one-month import should not blank a 30-day calculation that
   * the sample data can still answer.
   */
  async getLongBars(req: BarRequest, minBars: number): Promise<BarSeries | null> {
    const usual = await this.getBars(req);
    if (usual && usual.bars.length >= minBars) return usual;
    if (this.replayTime !== null && req.asOf === undefined) req = { ...req, asOf: this.replayTime };
    const sample = await this.samples.getBars(req);
    if (sample && sample.bars.length > (usual?.bars.length ?? 0)) return sample;
    return usual;
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
