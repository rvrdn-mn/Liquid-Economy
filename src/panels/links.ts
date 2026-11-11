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

/** XAU for gold, and the other currency for a dollar pair, so the grid stays narrow. The full name is in the tooltip. */
const short = (id: string) => (id === 'XAUUSD' ? 'XAU' : id.startsWith('USD') ? id.slice(3) : id.endsWith('USD') ? id.slice(0, 3) : id);
/** Two decimals, with a minus sign only: the colour already says which way. */
const signed = (r: number) => `${r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)}`;

export const linksPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  const windowBar = choiceBar<number>('Window in bars', WINDOWS, (bars) => state.update({ correlationWindow: bars }));
  const tfNote = h('span', { class: 'dim' });
  const content = h('div', {});
  body.append(h('div', { class: 'panel-toolbar' }, h('span', { class: 'dim' }, 'Window'), windowBar.el, tfNote), content);

  return live(ctx, async (current) => {
    const { watchlist, correlationWindow, correlationThreshold, displayZone } = state.settings;
    const timeframe = hub.timeframeFor(watchlist, state.settings.timeframe, 2);
    windowBar.set(correlationWindow);
    tfNote.textContent = timeframe === state.settings.timeframe ? `${timeframe} bars` : `${timeframe} bars (too little ${state.settings.timeframe} data)`;
    const view = await linksView(hub, watchlist, timeframe, correlationWindow, correlationThreshold);
    if (!current()) return;
    footer.textContent = loadedFooter(view.loaded, displayZone, watchlist.length);

    if (view.links.every((l) => l.r === null)) {
      const most = Math.max(0, ...view.links.map((l) => l.n));
      const detail =
        view.loaded.series.size < 2
          ? `Fewer than two watchlist instruments have ${timeframe} data. Import price files, or switch to D1 to use the sample set.`
          : `A ${correlationWindow}-bar window needs ${correlationWindow + 1} shared ${timeframe} bars; the most any two instruments share gives ${most} returns. Choose a smaller window.`;
      content.replaceChildren(emptyState('Links cannot be shown.', detail, { label: 'Import files', run: () => ctx.run('FILES') }));
      return;
    }

    const byKey = new Map<string, Link>();
    for (const l of view.links) byKey.set(`${l.a}|${l.b}`, l);
    const find = (a: string, b: string) => byKey.get(`${a}|${b}`) ?? byKey.get(`${b}|${a}`);

    const grid = h('table', { class: 'grid' });
    grid.append(h('thead', {}, h('tr', {}, h('th', {}, ''), ...view.instruments.map((id) => h('th', { class: 'num', title: id }, short(id))))));
    const tbody = h('tbody', {});
    for (const row of view.instruments) {
      const tr = h('tr', {}, h('th', { scope: 'row', title: row }, short(row)));
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
        td.style.backgroundColor = `rgba(${link.r >= 0 ? '57, 135, 229' : '217, 89, 38'}, ${(Math.abs(link.r) * 0.5).toFixed(3)})`;
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
        list.append(h('li', {}, h('span', { class: 'mono' }, `${l.a} and ${l.b}`), ` ${signed(l.r!)} `, h('span', { class: 'dim' }, l.r! > 0 ? 'moving together' : 'moving opposite')));
      }
      nodes.push(h('h3', {}, `Linked above ${correlationThreshold.toFixed(2)}`), list);
    }
    nodes.push(h('p', { class: 'dim note' }, `Correlation of bar-to-bar returns over the last ${correlationWindow} ${timeframe} bars both instruments share. Blue is moving together (toward +1), orange is moving opposite (toward −1); a stronger colour is a stronger link. Outlined cells are above the flag level.`));
    content.replaceChildren(...nodes);
  });
};
