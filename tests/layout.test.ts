import { describe, expect, it } from 'vitest';
import { closePanel, defaultLayout, findPanel, leaves, openPanel, parseLayout, setRatio, type Layout } from '../src/app/layout';

const codes = (l: Layout) => leaves(l.root).map((x) => x.panel);

describe('layout', () => {
  it('starts with the chart beside the files panel', () => {
    expect(codes(defaultLayout())).toEqual(['CHART', 'FILES']);
  });

  it('opens a panel by splitting the roomiest one', () => {
    const { layout, id } = openPanel(defaultLayout(), 'STR');
    expect(codes(layout)).toEqual(['CHART', 'STR', 'FILES']);
    expect(id).toBe('p3');
    expect(layout.nextId).toBe(4);
    // The chart (70% of the screen) was the one split, stacked top and bottom.
    const root = layout.root!;
    expect(root.type === 'split' && root.a.type === 'split' && root.a.dir).toBe('column');
  });

  it('shows each panel once', () => {
    const start = defaultLayout();
    const again = openPanel(start, 'CHART');
    expect(again.layout).toBe(start);
    expect(again.id).toBe('p1');
  });

  it('closes a panel and gives its space to the neighbour', () => {
    const one = closePanel(defaultLayout(), 'p2');
    expect(one.root).toEqual({ type: 'leaf', id: 'p1', panel: 'CHART' });
    const none = closePanel(one, 'p1');
    expect(none.root).toBeNull();
    const back = openPanel(none, 'HELP');
    expect(codes(back.layout)).toEqual(['HELP']);
  });

  it('never reuses a panel id', () => {
    let l = defaultLayout();
    l = closePanel(l, 'p2');
    const opened = openPanel(l, 'FILES');
    expect(opened.id).toBe('p3');
  });

  it('resizes a split and keeps both sides usable', () => {
    const l = setRatio(defaultLayout(), [], 0.4);
    expect((l.root as { ratio: number }).ratio).toBe(0.4);
    expect((setRatio(l, [], 0.99).root as { ratio: number }).ratio).toBe(0.9);
    expect((setRatio(l, [], -1).root as { ratio: number }).ratio).toBe(0.1);
    const nested = openPanel(defaultLayout(), 'STR').layout;
    const resized = setRatio(nested, ['a'], 0.25);
    const a = (resized.root as { a: { ratio: number } }).a;
    expect(a.ratio).toBe(0.25);
    expect((resized.root as { ratio: number }).ratio).toBe(0.7);
  });

  it('survives a save and reload', () => {
    const l = openPanel(defaultLayout(), 'WX').layout;
    expect(parseLayout(JSON.stringify(l))).toEqual(l);
    expect(findPanel(parseLayout(JSON.stringify(l))!, 'WX')).toBeDefined();
  });

  it('rejects a damaged saved layout so the default is used instead', () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('not json')).toBeNull();
    expect(parseLayout('{"root":{"type":"leaf","id":"p1","panel":"NOPE"},"nextId":2}')).toBeNull();
    expect(parseLayout('{"root":{"type":"split","dir":"row","ratio":5,"a":null,"b":null},"nextId":2}')).toBeNull();
    const dup = { root: { type: 'split', dir: 'row', ratio: 0.5, a: { type: 'leaf', id: 'p1', panel: 'CHART' }, b: { type: 'leaf', id: 'p1', panel: 'FILES' } }, nextId: 2 };
    expect(parseLayout(JSON.stringify(dup))).toBeNull();
    expect(parseLayout('{"root":null,"nextId":4}')).toEqual({ root: null, nextId: 4 });
  });
});
