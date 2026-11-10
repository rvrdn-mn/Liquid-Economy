/**
 * App state shared by the panels: what is selected, the settings, and the
 * layout. Saved in the browser so a refresh changes nothing.
 */
import { TIMEFRAMES, type InstrumentId, type Timeframe } from '../data/types';
import { isInstrument } from '../data/instruments';
import type { DayRoll } from '../data/aggregate';
import { isFileZone, type FileZone } from '../data/fileZone';
import { defaultLayout, parseLayout, type Layout } from './layout';

export interface Settings {
  instrument: InstrumentId;
  timeframe: Timeframe;
  /** How times are shown. Stored times are always UTC. */
  displayZone: 'local' | 'utc';
  /** Where built four-hour and daily bars begin. */
  dayRoll: DayRoll;
  /** The clock assumed for the next imported file. */
  importZone: FileZone;
}

export const DEFAULT_SETTINGS: Settings = {
  instrument: 'XAUUSD',
  timeframe: 'D1',
  displayZone: 'local',
  dayRoll: 'ny17',
  importZone: 'histdata',
};

const SETTINGS_KEY = 'lmd.settings.v1';
const LAYOUT_KEY = 'lmd.layout.v1';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: run with defaults, nothing is lost but persistence
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked or full: keep working in memory */
  }
}

export function parseSettings(json: string | null): Settings {
  const out = { ...DEFAULT_SETTINGS };
  if (!json) return out;
  try {
    const s = JSON.parse(json) as Partial<Settings>;
    if (typeof s.instrument === 'string' && isInstrument(s.instrument)) out.instrument = s.instrument;
    if (TIMEFRAMES.includes(s.timeframe as Timeframe)) out.timeframe = s.timeframe as Timeframe;
    if (s.displayZone === 'local' || s.displayZone === 'utc') out.displayZone = s.displayZone;
    if (s.dayRoll === 'ny17' || s.dayRoll === 'utc') out.dayRoll = s.dayRoll;
    if (isFileZone(s.importZone)) out.importZone = s.importZone;
  } catch {
    /* damaged: defaults */
  }
  return out;
}

type Listener = () => void;

export class AppState {
  settings: Settings = parseSettings(read(SETTINGS_KEY));
  layout: Layout = parseLayout(read(LAYOUT_KEY)) ?? defaultLayout();
  private readonly settingsListeners = new Set<Listener>();
  private readonly layoutListeners = new Set<Listener>();

  update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    write(SETTINGS_KEY, JSON.stringify(this.settings));
    this.settingsListeners.forEach((fn) => fn());
  }

  /** `quiet` saves without redrawing, for a splitter that is mid-drag. */
  setLayout(layout: Layout, quiet = false): void {
    if (layout === this.layout) return;
    this.layout = layout;
    write(LAYOUT_KEY, JSON.stringify(layout));
    if (!quiet) this.layoutListeners.forEach((fn) => fn());
  }

  onSettings(fn: Listener): () => void {
    this.settingsListeners.add(fn);
    return () => this.settingsListeners.delete(fn);
  }

  onLayout(fn: Listener): () => void {
    this.layoutListeners.add(fn);
    return () => this.layoutListeners.delete(fn);
  }
}
