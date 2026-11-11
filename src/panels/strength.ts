/** Strength board: the eight currencies ranked strongest to weakest. Drawing only. */
import { strengthView } from '../app/analysis';
import type { Currency } from '../data/types';
import { h } from '../ui/dom';
import { asOfText, choiceBar, emptyState, live, loadedFooter, svg } from './common';
import type { PanelFactory } from './types';

const LOOKBACKS = [
  { value: 4, text: '4H' },
  { value: 24, text: '24H' },
  { value: 168, text: '1W' },
  { value: 720, text: '1M' },
] as const;

function sparkline(values: (number | null)[]): SVGSVGElement {
  const w = 96;
  const ht = 18;
  const pts: string[] = [];
  const n = values.length;
  values.forEach((v, i) => {
    if (v === null) return;
    const x = n === 1 ? w : (i / (n - 1)) * w;
    const y = ht - 1 - (v / 100) * (ht - 2);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  const el = svg('svg', { class: 'spark', width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, role: 'img', 'aria-label': 'Strength history' });
  el.append(svg('line', { x1: 0, x2: w, y1: ht / 2, y2: ht / 2, class: 'spark-mid' }));
  if (pts.length > 1) el.append(svg('polyline', { points: pts.join(' '), class: 'spark-line' }));
  return el;
}

export const strengthPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  const lookback = choiceBar<number>('Lookback', LOOKBACKS, (hours) => state.update({ strengthLookbackHours: hours }));
  const tfNote = h('span', { class: 'dim' });
  const content = h('div', {});
  body.append(h('div', { class: 'panel-toolbar' }, h('span', { class: 'dim' }, 'Lookback'), lookback.el, tfNote), content);

  return live(ctx, async (current) => {
    const { timeframe, strengthLookbackHours, displayZone } = state.settings;
    lookback.set(strengthLookbackHours);
    tfNote.textContent = `on ${timeframe} bars`;
    const view = await strengthView(hub, timeframe, strengthLookbackHours);
    if (!current()) return;

    if (!view.now) {
      content.replaceChildren(emptyState('Strength cannot be shown.', view.reason ?? '', { label: 'Open Files', run: () => ctx.run('FILES') }));
      footer.textContent = loadedFooter(view.loaded, displayZone, 28);
      return;
    }
    const { now } = view;
    const nodes: Node[] = [];
    if (view.spotlight) {
      const { pair, strong, weak } = view.spotlight;
      const open = h('button', { type: 'button', class: 'link spotlight-pair', title: `Chart ${pair}` }, pair);
      open.addEventListener('click', () => ctx.run(`${pair} CHART`));
      nodes.push(h('p', { class: 'spotlight' }, 'Strongest against weakest: ', open, h('span', { class: 'dim' }, ` (${strong} strongest, ${weak} weakest)`)));
    }
    const table = h('table', { class: 'strength' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Ccy'), h('th', {}, 'Strength'), h('th', { class: 'num' }, 'Avg move'), h('th', {}, 'History'))));
    const tbody = h('tbody', {});
    now.ranked.forEach((ccy: Currency, i) => {
      const score = now.score[ccy]!;
      const avg = now.average[ccy]!;
      const fill = h('span', { class: 'meter-fill' });
      fill.style.width = `${score}%`;
      const edge = i === 0 || i === now.ranked.length - 1;
      tbody.append(
        h(
          'tr',
          { class: edge ? 'edge' : '' },
          h('td', { class: 'dim' }, String(i + 1)),
          h('td', { class: 'ccy' }, ccy),
          h('td', {}, h('span', { class: 'meter' }, fill), h('span', { class: 'score' }, score.toFixed(0))),
          h('td', { class: `num ${avg > 0 ? 'up' : avg < 0 ? 'down' : ''}` }, `${avg > 0 ? '+' : ''}${avg.toFixed(3)}%`),
          h('td', {}, sparkline(view.history[ccy])),
        ),
      );
    });
    table.append(tbody);
    nodes.push(table);
    const short = Object.entries(now.pairsUsed).filter(([, n]) => n < 7);
    if (short.length > 0) {
      nodes.push(h('p', { class: 'warn' }, `Some pairs have no data, so these averages use fewer than seven pairs: ${short.map(([c, n]) => `${c} ${n}/7`).join(', ')}.`));
    }
    nodes.push(h('p', { class: 'dim note' }, `Each currency's average move against the other seven over the lookback, rescaled so the weakest is 0 and the strongest 100. History: ${view.historyTimes.length} bars to ${asOfText(view.loaded, displayZone)}.`));
    content.replaceChildren(...nodes);
    footer.textContent = loadedFooter(view.loaded, displayZone, 28);
  });
};
