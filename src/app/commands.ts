/**
 * Command bar language. Pure functions: text in, commands out.
 *
 *   XAU, EURUSD, EUR/USD   load an instrument in the chart
 *   M5 M15 H1 H4 D1        switch the chart timeframe
 *   CHART, STR, WX, ...    open a panel
 *   HELP                   list every command
 *
 * Several can be typed at once ("XAU H1"). Unknown input never errors: it
 * comes back with the closest matches.
 */
import { TIMEFRAMES, type InstrumentId, type Timeframe } from '../data/types';
import { FX_PAIRS, GOLD, normaliseSymbol } from '../data/instruments';
import { PANELS, PANEL_CODES, isPanelCode, type PanelCode } from './panels';
import { WORKSPACES, type WorkspaceId } from './workspaces';

export interface Suggestion {
  /** What to type. */
  text: string;
  description: string;
}

export type Command =
  | { kind: 'instrument'; instrument: InstrumentId }
  | { kind: 'timeframe'; timeframe: Timeframe }
  | { kind: 'panel'; code: PanelCode }
  | { kind: 'page'; page: WorkspaceId }
  | { kind: 'unknown'; input: string; suggestions: Suggestion[] };

const TIMEFRAME_NAMES: Record<Timeframe, string> = {
  M5: '5 minute chart',
  M15: '15 minute chart',
  H1: '1 hour chart',
  H4: '4 hour chart',
  D1: 'Daily chart',
};

const pairLabel = (id: InstrumentId) => (id === GOLD ? 'Gold in US dollars' : `${id.slice(0, 3)} / ${id.slice(3)}`);

/**
 * Pages that can be opened by name. The others are reached by a panel code
 * of the same meaning (NEWS, LAB, HELP), and GOLD stays the instrument.
 */
export const PAGE_WORDS: Record<string, WorkspaceId> = { OVERVIEW: 'overview', CURRENCIES: 'currencies', JOURNAL: 'journal', DATA: 'data', SETTINGS: 'settings' };

/** Everything the bar understands, in the order HELP lists it. */
export const VOCABULARY: readonly Suggestion[] = [
  ...Object.entries(PAGE_WORDS).map(([word, id]) => ({ text: word, description: `Page: ${WORKSPACES[id].summary}` })),
  ...PANEL_CODES.map((code) => ({ text: code, description: `${PANELS[code].title}: ${PANELS[code].description}` })),
  ...TIMEFRAMES.map((tf) => ({ text: tf, description: TIMEFRAME_NAMES[tf] })),
  { text: 'XAU', description: pairLabel(GOLD) },
  ...FX_PAIRS.map((id) => ({ text: id, description: pairLabel(id) })),
];

function parseToken(token: string): Command | null {
  const upper = token.toUpperCase();
  if (isPanelCode(upper)) return { kind: 'panel', code: upper };
  const page = PAGE_WORDS[upper];
  if (page) return { kind: 'page', page };
  const tf = TIMEFRAMES.find((t) => t === upper);
  if (tf) return { kind: 'timeframe', timeframe: tf };
  const instrument = normaliseSymbol(token);
  if (instrument) return { kind: 'instrument', instrument };
  return null;
}

/** Edit distance, for catching typos such as "EURSUD". Swapped neighbours count as one slip. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = new Array<number>(rows * cols).fill(0);
  const at = (i: number, j: number) => d[i * cols + j]!;
  for (let i = 0; i < rows; i++) d[i * cols] = i;
  for (let j = 0; j < cols; j++) d[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      d[i * cols + j] = best;
    }
  }
  return at(a.length, b.length);
}

/**
 * Closest things the bar understands. Used both while typing and when
 * something unknown is entered. Best first: exact start, then contains
 * (so "EUR" lists the euro pairs), then near-misses.
 */
export function suggest(partial: string, limit = 6): Suggestion[] {
  const q = partial.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (q === '') return [];
  const scored: { s: Suggestion; score: number; order: number }[] = [];
  VOCABULARY.forEach((s, order) => {
    const text = s.text === 'XAU' ? 'XAUUSD' : s.text;
    let score: number;
    if (text.startsWith(q) || s.text.startsWith(q)) score = 0;
    else if (text.includes(q)) score = 1;
    else {
      const distance = editDistance(q, s.text);
      const allowed = q.length <= 3 ? 1 : 2;
      if (distance > allowed) return;
      score = 1 + distance;
    }
    scored.push({ s, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((x) => x.s);
}

export function parseCommand(input: string): Command[] {
  const trimmed = input.trim();
  if (trimmed === '') return [];
  // "EUR USD" and "eur/usd" are one instrument, not two unknown words.
  const whole = parseToken(trimmed.replace(/\s+/g, ''));
  const tokens = trimmed.split(/\s+/);
  const perToken = tokens.map((t) => parseToken(t));
  if (whole && whole.kind === 'instrument' && perToken.some((c) => c === null)) return [whole];
  return tokens.map((t, i) => perToken[i] ?? { kind: 'unknown', input: t, suggestions: suggest(t) });
}
