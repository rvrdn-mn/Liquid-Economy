/** Linked pairs: a correlation grid for the watchlist. Drawing only. */
import { linksView } from '../app/analysis';
import type { Link } from '../calc/correlation';
import { h } from '../ui/dom';
import { choiceBar, emptyState, live, loadedFooter } from './common';
import type { PanelFactory } from './types';

const WINDOWS = [
  { value: 20, text: '20' },
  { value: 50, text: '50' },
  { value: 100, text: '100' },
] as const;

const short = (id: string) => (id === 'XAUUSD' ? 'XAU' : id);
const signed = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`;

export const linksPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  const windowBar = choiceBar<number>('Window in bars', WINDOWS, (bars) => state.update({ correlationWindow: bars }));
  const tfNote = h('span', { class: 'dim' });
  const content = h('div', {});
  body.append(h('div', { class: 'panel-toolbar' }, h('span', { class: 'dim' }, 'Window'), windowBar.el, tfNote), content);

  return live(ctx, async (current) => {
    const { timeframe, watchlist, correlationWindow, correlationThreshold, displayZone } = state.settings;
    windowBar.set(correlationWindow);
    tfNote.textContent = `${timeframe} bars`;
    const view = await linksView(hub, watchlist, timeframe, correlationWindow, correlationThreshold);
    if (!current()) return;
    footer.textContent = loadedFooter(view.loaded, displayZone, watchlist.length);

    if (view.links.every((l) => l.r === null)) {
      const most = Math.max(0, ...view.links.map((l) => l.n));
      const detail =
        view.loaded.series.size < 2
          ? `Fewer than two watchlist instruments have ${timeframe} data. Import price files, or switch to D1 to use the sample set.`
          : `A ${correlationWindow}-bar window needs ${correlationWindow + 1} shared ${timeframe} bars; the most any two instruments share gives ${most} returns. Choose a smaller window.`;
      content.replaceChildren(emptyState('Links cannot be shown.', detail, { label: 'Open Files', run: () => ctx.run('FILES') }));
      return;
    }

    const byKey = new Map<string, Link>();
    for (const l of view.links) byKey.set(`${l.a}|${l.b}`, l);
    const find = (a: string, b: string) => byKey.get(`${a}|${b}`) ?? byKey.get(`${b}|${a}`);

    const grid = h('table', { class: 'grid' });
    grid.append(h('thead', {}, h('tr', {}, h('th', {}, ''), ...view.instruments.map((id) => h('th', { class: 'num' }, short(id))))));
    const tbody = h('tbody', {});
    for (const row of view.instruments) {
      const tr = h('tr', {}, h('th', { scope: 'row' }, short(row)));
      for (const col of view.instruments) {
        if (row === col) {
          tr.append(h('td', { class: 'num self' }, '·'));
          continue;
        }
        const link = find(row, col)!;
        if (link.r === null) {
          tr.append(h('td', { class: 'num dim', title: `Not enough shared data: ${link.n} of ${correlationWindow} returns` }, '–'));
          continue;
        }
        const flagged = Math.abs(link.r) > correlationThreshold;
        const td = h('td', { class: `num cell ${flagged ? 'flagged' : ''}`, title: `${row} and ${col}: ${signed(link.r)} over ${link.n} returns` }, signed(link.r));
        td.style.backgroundColor = `rgba(79, 179, 200, ${(Math.abs(link.r) * 0.45).toFixed(3)})`;
        tr.append(td);
      }
      tbody.append(tr);
    }
    grid.append(tbody);

    const nodes: Node[] = [grid];
    if (view.flagged.length === 0) {
      nodes.push(h('p', { class: 'note' }, `No two instruments are above ${correlationThreshold.toFixed(2)} in either direction.`));
    } else {
      const list = h('ul', { class: 'flag-list' });
      for (const l of view.flagged) {
        list.append(h('li', {}, h('span', { class: 'mono' }, `${short(l.a)} and ${short(l.b)}`), ` ${signed(l.r!)} `, h('span', { class: 'dim' }, l.r! > 0 ? 'moving together' : 'moving opposite')));
      }
      nodes.push(h('h3', {}, `Linked above ${correlationThreshold.toFixed(2)}`), list);
    }
    nodes.push(h('p', { class: 'dim note' }, `Correlation of bar-to-bar returns over the last ${correlationWindow} ${timeframe} bars both instruments share. +1 is moving together, −1 is moving opposite, 0 is unrelated. Outlined cells are above the flag level.`));
    content.replaceChildren(...nodes);
  });
};
