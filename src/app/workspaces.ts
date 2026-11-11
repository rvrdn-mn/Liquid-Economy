/**
 * Workspaces: named pages, each with its own arrangement of panels. They
 * are what the sidebar switches between. Pure.
 *
 * A panel can still be opened anywhere from the command bar; a workspace
 * is only a sensible starting arrangement that the user can then change.
 */
import type { Layout, LayoutNode } from './layout';
import type { PanelCode } from './panels';

export const WORKSPACE_IDS = ['overview', 'currencies', 'gold', 'journal', 'news', 'data', 'lab', 'settings', 'help'] as const;
export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export interface WorkspaceInfo {
  id: WorkspaceId;
  name: string;
  /** One line under the page title. */
  summary: string;
  group: 'analysis' | 'records' | 'tools' | 'system';
}

export const WORKSPACES: Record<WorkspaceId, WorkspaceInfo> = {
  overview: { id: 'overview', name: 'Overview', summary: 'Chart, weather map and strength board', group: 'analysis' },
  currencies: { id: 'currencies', name: 'Currencies', summary: 'Strength, volatility, sessions and linked pairs', group: 'analysis' },
  gold: { id: 'gold', name: 'Gold', summary: 'What has been moving with gold', group: 'analysis' },
  journal: { id: 'journal', name: 'Journal', summary: 'Your trades and how they went', group: 'records' },
  news: { id: 'news', name: 'News', summary: 'Central-bank announcements', group: 'records' },
  data: { id: 'data', name: 'Data', summary: 'Import price files and see what is loaded', group: 'tools' },
  lab: { id: 'lab', name: 'Lab', summary: 'A what-if teaching model', group: 'tools' },
  settings: { id: 'settings', name: 'Settings', summary: 'Defaults, watchlist and stored data', group: 'system' },
  help: { id: 'help', name: 'Help', summary: 'Commands and how to read each view', group: 'system' },
};

type Spec = PanelCode | { dir: 'row' | 'column'; ratio: number; a: Spec; b: Spec };

const SPECS: Record<WorkspaceId, Spec> = {
  overview: { dir: 'row', ratio: 0.5, a: 'CHART', b: { dir: 'column', ratio: 0.58, a: 'WX', b: 'STR' } },
  currencies: { dir: 'row', ratio: 0.6, a: { dir: 'column', ratio: 0.58, a: 'WX', b: { dir: 'row', ratio: 0.5, a: 'VOL', b: 'LINK' } }, b: { dir: 'column', ratio: 0.5, a: 'STR', b: 'SES' } },
  gold: { dir: 'row', ratio: 0.56, a: 'LIQ', b: 'DRV' },
  journal: { dir: 'row', ratio: 0.5, a: 'JRN', b: 'CHART' },
  news: 'NEWS',
  data: 'FILES',
  lab: 'LAB',
  settings: 'SET',
  help: 'HELP',
};

/** The starting arrangement of a workspace. */
export function defaultWorkspaceLayout(id: WorkspaceId): Layout {
  let n = 0;
  const build = (spec: Spec): LayoutNode =>
    typeof spec === 'string' ? { type: 'leaf', id: `p${++n}`, panel: spec } : { type: 'split', dir: spec.dir, ratio: spec.ratio, a: build(spec.a), b: build(spec.b) };
  const root = build(SPECS[id]);
  return { root, nextId: n + 1 };
}

function panelsOf(spec: Spec): PanelCode[] {
  return typeof spec === 'string' ? [spec] : [...panelsOf(spec.a), ...panelsOf(spec.b)];
}

/**
 * The workspace a panel belongs to by default, used when a panel is asked
 * for by its code and is not on the current page. The most specific page
 * wins: the weather map lives on Currencies, though Overview shows it too.
 */
export function homeWorkspace(panel: PanelCode): WorkspaceId | null {
  const order: WorkspaceId[] = ['gold', 'journal', 'news', 'data', 'lab', 'settings', 'help', 'currencies', 'overview'];
  return order.find((id) => panelsOf(SPECS[id]).includes(panel)) ?? null;
}

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && (WORKSPACE_IDS as readonly string[]).includes(value);
}
