/**
 * Panel layout as a tree. Pure functions: every change returns a new tree,
 * which is what gets saved to the browser.
 *
 * A leaf is one panel. A split holds two children side by side ('row') or
 * stacked ('column'); `ratio` is the first child's share of the space.
 */
import { isPanelCode, type PanelCode } from './panels';

export interface Leaf {
  type: 'leaf';
  id: string;
  panel: PanelCode;
}
export interface Split {
  type: 'split';
  dir: 'row' | 'column';
  ratio: number;
  a: LayoutNode;
  b: LayoutNode;
}
export type LayoutNode = Leaf | Split;

export interface Layout {
  root: LayoutNode | null;
  nextId: number;
}

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
const clamp = (r: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));

export function defaultLayout(): Layout {
  return {
    root: {
      type: 'split',
      dir: 'row',
      ratio: 0.7,
      a: { type: 'leaf', id: 'p1', panel: 'CHART' },
      b: { type: 'leaf', id: 'p2', panel: 'FILES' },
    },
    nextId: 3,
  };
}

export function leaves(node: LayoutNode | null): Leaf[] {
  if (!node) return [];
  return node.type === 'leaf' ? [node] : [...leaves(node.a), ...leaves(node.b)];
}

export function findPanel(layout: Layout, panel: PanelCode): Leaf | undefined {
  return leaves(layout.root).find((l) => l.panel === panel);
}

/** Share of the whole screen each leaf takes, used to pick the roomiest. */
function areas(node: LayoutNode, share: number, depth: number, out: { leaf: Leaf; share: number; depth: number }[]) {
  if (node.type === 'leaf') out.push({ leaf: node, share, depth });
  else {
    areas(node.a, share * node.ratio, depth + 1, out);
    areas(node.b, share * (1 - node.ratio), depth + 1, out);
  }
  return out;
}

function replace(node: LayoutNode, id: string, make: (leaf: Leaf) => LayoutNode | null): LayoutNode | null {
  if (node.type === 'leaf') return node.id === id ? make(node) : node;
  const a = replace(node.a, id, make);
  const b = replace(node.b, id, make);
  if (a === null) return b;
  if (b === null) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/**
 * Open a panel. Each panel is shown once: if it is already open the layout
 * is returned unchanged. Otherwise the roomiest panel is split in two.
 */
export function openPanel(layout: Layout, panel: PanelCode): { layout: Layout; id: string } {
  const existing = findPanel(layout, panel);
  if (existing) return { layout, id: existing.id };
  const id = `p${layout.nextId}`;
  const leaf: Leaf = { type: 'leaf', id, panel };
  if (!layout.root) return { layout: { root: leaf, nextId: layout.nextId + 1 }, id };

  const target = areas(layout.root, 1, 0, []).sort((x, y) => y.share - x.share)[0]!;
  // Alternate direction with depth so panels stay roughly screen-shaped.
  const dir = target.depth % 2 === 0 ? 'row' : 'column';
  const root = replace(layout.root, target.leaf.id, (old) => ({ type: 'split', dir, ratio: 0.5, a: old, b: leaf }));
  return { layout: { root, nextId: layout.nextId + 1 }, id };
}

/** Close a panel; its neighbour takes the freed space. */
export function closePanel(layout: Layout, id: string): Layout {
  if (!layout.root) return layout;
  return { ...layout, root: replace(layout.root, id, () => null) };
}

/** Set the ratio of the split found by walking `path` ('a' / 'b' steps) from the root. */
export function setRatio(layout: Layout, path: readonly ('a' | 'b')[], ratio: number): Layout {
  const walk = (node: LayoutNode, i: number): LayoutNode => {
    if (node.type !== 'split') return node;
    if (i === path.length) return { ...node, ratio: clamp(ratio) };
    const step = path[i]!;
    return { ...node, [step]: walk(node[step], i + 1) };
  };
  return layout.root ? { ...layout, root: walk(layout.root, 0) } : layout;
}

/** Read a saved layout, rejecting anything malformed (old versions, hand edits). */
export function parseLayout(json: string | null): Layout | null {
  if (!json) return null;
  try {
    const data = JSON.parse(json) as Layout;
    const seen = new Set<string>();
    const ok = (n: unknown): boolean => {
      if (!n || typeof n !== 'object') return false;
      const node = n as LayoutNode;
      if (node.type === 'leaf') {
        if (typeof node.id !== 'string' || !isPanelCode(node.panel) || seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
      }
      return (
        node.type === 'split' &&
        (node.dir === 'row' || node.dir === 'column') &&
        typeof node.ratio === 'number' &&
        node.ratio >= MIN_RATIO &&
        node.ratio <= MAX_RATIO &&
        ok(node.a) &&
        ok(node.b)
      );
    };
    if (typeof data.nextId !== 'number') return null;
    if (data.root !== null && !ok(data.root)) return null;
    return { root: data.root, nextId: data.nextId };
  } catch {
    return null;
  }
}
