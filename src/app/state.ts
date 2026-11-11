/**
 * App state shared by the panels: what is selected, the settings, and the
 * layout. Saved in the browser so a refresh changes nothing.
 */
import { TIMEFRAMES, type InstrumentId, type Timeframe } from '../data/types';
import { isInstrument } from '../data/instruments';
import type { DayRoll } from '../data/aggregate';
import { isFileZone, type FileZone } from '../data/fileZone';
import { parseLayout, type Layout } from './layout';
import { defaultWorkspaceLayout, isWorkspaceId, WORKSPACE_IDS, type WorkspaceId } from './workspaces';

export interface Settings {
  instrument: InstrumentId;
  timeframe: Timeframe;
  /** How times are shown. Stored times are always UTC. */
  displayZone: 'local' | 'utc';
  /** Where built four-hour and daily bars begin. */
  dayRoll: DayRoll;
  /** The clock assumed for the next imported file. */
  importZone: FileZone;
  /** Strength board lookback, in hours. Spec default 24. */
  strengthLookbackHours: number;
  /** Bars in the average true range. Spec default 14. */
  atrPeriod: number;
  /** Days of history the current volatility is compared with. Spec default 20. */
  volatilityBaselineDays: number;
  /** Days of history in the session profile. Spec default 30. */
  sessionProfileDays: number;
  /** Bars in the rolling correlation. Spec default 50. */
  correlationWindow: number;
  /** Two instruments are flagged as linked above this absolute correlation. Spec default 0.8. */
  correlationThreshold: number;
  /** Instruments in the linked-pairs grid. */
  watchlist: InstrumentId[];
  /** Daily bars in the gold-driver correlation. Spec default 30. */
  driverWindow: number;
  /** Ask gold-api.com for the gold price every 30 seconds. */
  liveGold: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  instrument: 'XAUUSD',
  timeframe: 'D1',
  displayZone: 'local',
  dayRoll: 'ny17',
  importZone: 'histdata',
  strengthLookbackHours: 24,
  atrPeriod: 14,
  volatilityBaselineDays: 20,
  sessionProfileDays: 30,
  correlationWindow: 50,
  correlationThreshold: 0.8,
  watchlist: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD'],
  driverWindow: 30,
  liveGold: true,
};

const SETTINGS_KEY = 'lmd.settings.v1';
const LAYOUT_KEY = 'lmd.workspaces.v2';

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
  const out: Settings = { ...DEFAULT_SETTINGS, watchlist: [...DEFAULT_SETTINGS.watchlist] };
  if (!json) return out;
  try {
    const s = JSON.parse(json) as Partial<Settings>;
    if (typeof s.instrument === 'string' && isInstrument(s.instrument)) out.instrument = s.instrument;
    if (TIMEFRAMES.includes(s.timeframe as Timeframe)) out.timeframe = s.timeframe as Timeframe;
    if (s.displayZone === 'local' || s.displayZone === 'utc') out.displayZone = s.displayZone;
    if (s.dayRoll === 'ny17' || s.dayRoll === 'utc') out.dayRoll = s.dayRoll;
    if (isFileZone(s.importZone)) out.importZone = s.importZone;
    const whole = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
    if (whole(s.strengthLookbackHours, 1, 24 * 366)) out.strengthLookbackHours = s.strengthLookbackHours;
    if (whole(s.atrPeriod, 2, 200)) out.atrPeriod = s.atrPeriod;
    if (whole(s.volatilityBaselineDays, 2, 366)) out.volatilityBaselineDays = s.volatilityBaselineDays;
    if (whole(s.sessionProfileDays, 2, 366)) out.sessionProfileDays = s.sessionProfileDays;
    if (whole(s.correlationWindow, 5, 1000)) out.correlationWindow = s.correlationWindow;
    if (whole(s.driverWindow, 5, 500)) out.driverWindow = s.driverWindow;
    if (typeof s.liveGold === 'boolean') out.liveGold = s.liveGold;
    if (typeof s.correlationThreshold === 'number' && s.correlationThreshold > 0 && s.correlationThreshold < 1) {
      out.correlationThreshold = s.correlationThreshold;
    }
    if (Array.isArray(s.watchlist)) {
      const list = [...new Set(s.watchlist.filter((x): x is InstrumentId => typeof x === 'string' && isInstrument(x)))];
      if (list.length >= 2) out.watchlist = list;
    }
  } catch {
    /* damaged: defaults */
  }
  return out;
}

type Listener = () => void;

interface SavedWorkspaces {
  current: WorkspaceId;
  layouts: Record<WorkspaceId, Layout>;
}

/** Read the saved pages; anything missing or damaged falls back to that page's starting arrangement. */
export function parseWorkspaces(json: string | null): SavedWorkspaces {
  const out: SavedWorkspaces = {
    current: 'overview',
    layouts: Object.fromEntries(WORKSPACE_IDS.map((id) => [id, defaultWorkspaceLayout(id)])) as Record<WorkspaceId, Layout>,
  };
  if (!json) return out;
  try {
    const saved = JSON.parse(json) as { current?: unknown; layouts?: Record<string, unknown> };
    if (isWorkspaceId(saved.current)) out.current = saved.current;
    for (const id of WORKSPACE_IDS) {
      const layout = parseLayout(JSON.stringify(saved.layouts?.[id] ?? null));
      if (layout) out.layouts[id] = layout;
    }
  } catch {
    /* damaged: defaults */
  }
  return out;
}

export class AppState {
  settings: Settings = parseSettings(read(SETTINGS_KEY));
  private readonly saved: SavedWorkspaces = parseWorkspaces(read(LAYOUT_KEY));
  private readonly settingsListeners = new Set<Listener>();
  private readonly layoutListeners = new Set<Listener>();

  /** The page being shown. */
  get workspace(): WorkspaceId {
    return this.saved.current;
  }

  /** The arrangement of the page being shown. */
  get layout(): Layout {
    return this.saved.layouts[this.saved.current];
  }

  /** The arrangement of any page, shown or not. */
  layoutOf(id: WorkspaceId): Layout {
    return this.saved.layouts[id];
  }

  private saveWorkspaces(): void {
    write(LAYOUT_KEY, JSON.stringify(this.saved));
  }

  setWorkspace(id: WorkspaceId): void {
    if (id === this.saved.current) return;
    this.saved.current = id;
    this.saveWorkspaces();
    this.layoutListeners.forEach((fn) => fn());
  }

  /** Change settings. Values outside their allowed range fall back to the default. */
  update(patch: Partial<Settings>): void {
    this.settings = parseSettings(JSON.stringify({ ...this.settings, ...patch }));
    write(SETTINGS_KEY, JSON.stringify(this.settings));
    this.settingsListeners.forEach((fn) => fn());
  }

  /** `quiet` saves without redrawing, for a splitter that is mid-drag. */
  setLayout(layout: Layout, quiet = false): void {
    if (layout === this.layout) return;
    this.saved.layouts[this.saved.current] = layout;
    this.saveWorkspaces();
    if (!quiet) this.layoutListeners.forEach((fn) => fn());
  }

  /** Put every setting back to its default, keeping the selected instrument and timeframe. */
  resetSettings(): void {
    const { instrument, timeframe } = this.settings;
    this.update({ ...DEFAULT_SETTINGS, watchlist: [...DEFAULT_SETTINGS.watchlist], instrument, timeframe });
  }

  /** Put the current page back to its starting arrangement. */
  resetLayout(): void {
    this.setLayout(defaultWorkspaceLayout(this.saved.current));
  }

  /** Put every page back to its starting arrangement. */
  resetAllLayouts(): void {
    for (const id of WORKSPACE_IDS) this.saved.layouts[id] = defaultWorkspaceLayout(id);
    this.saveWorkspaces();
    this.layoutListeners.forEach((fn) => fn());
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
