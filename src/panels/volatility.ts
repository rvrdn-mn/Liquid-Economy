/** Volatility: each instrument against its own recent average. Drawing only. */
import { volatilityView } from '../app/analysis';
import { INSTRUMENTS } from '../data/instruments';
import { h } from '../ui/dom';
import { asOfText, emptyState, live, loadedFooter } from './common';
import type { PanelFactory } from './types';

export const volatilityPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  const content = h('div', {});
  body.append(content);

  return live(ctx, async (current) => {
    const { timeframe, atrPeriod, volatilityBaselineDays, displayZone } = state.settings;
    const view = await volatilityView(hub, INSTRUMENTS, timeframe, atrPeriod, volatilityBaselineDays);
    if (!current()) return;
    footer.textContent = loadedFooter(view.loaded, displayZone, INSTRUMENTS.length);

    if (view.rows.length === 0) {
      const detail =
        view.loaded.series.size === 0
          ? `No ${timeframe} data is loaded. Import price files, or switch to D1 to use the sample set.`
          : `The loaded ${timeframe} data is too short: it needs more than ${atrPeriod} bars.`;
      content.replaceChildren(emptyState('Volatility cannot be shown.', detail, { label: 'Open Files', run: () => ctx.run('FILES') }));
      return;
    }

    const table = h(
      'table',
      { class: 'vol' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Instrument'), h('th', { class: 'num' }, 'Now'), h('th', { class: 'num' }, `${volatilityBaselineDays}d avg`), h('th', { class: 'num' }, 'Ratio'), h('th', {}, ''))),
    );
    const tbody = h('tbody', {});
    const scale = Math.max(2, ...view.rows.map((r) => r.reading.ratio));
    for (const row of view.rows) {
      const { current: now, baseline, ratio } = row.reading;
      const open = h('button', { type: 'button', class: 'link', title: `Chart ${row.instrument}` }, row.instrument);
      open.addEventListener('click', () => ctx.run(`${row.instrument} CHART`));
      const fill = h('span', { class: `meter-fill ${ratio > 1 ? 'hot' : 'calm'}` });
      fill.style.width = `${(ratio / scale) * 100}%`;
      const mark = h('span', { class: 'meter-mark', title: 'Usual level' });
      mark.style.left = `${(1 / scale) * 100}%`;
      tbody.append(
        h(
          'tr',
          { class: ratio > 1 ? 'busy' : '' },
          h('td', {}, open, row.closeOnly ? h('span', { class: 'warn', title: 'One value per bar: no high or low' }, ' †') : null),
          h('td', { class: 'num' }, `${now.toFixed(3)}%`),
          h('td', { class: 'num dim' }, `${baseline.toFixed(3)}%`),
          h('td', { class: `num ratio ${ratio > 1 ? 'hot' : 'dim'}` }, ratio.toFixed(2)),
          h('td', { class: 'meter-cell' }, h('span', { class: 'meter wide' }, fill, mark)),
        ),
      );
    }
    table.append(tbody);
    const nodes: Node[] = [];
    if (view.rows.some((r) => r.closeOnly)) {
      nodes.push(h('p', { class: 'warn' }, 'Rows marked † have one value per bar and no high or low, so their range is the move from one close to the next. Real candles give a truer reading.'));
    }
    nodes.push(table);
    if (view.tooShort.length > 0) nodes.push(h('p', { class: 'dim note' }, `Too little data for: ${view.tooShort.join(', ')}.`));
    if (view.loaded.missing.length > 0) nodes.push(h('p', { class: 'dim note' }, `No ${timeframe} data for ${view.loaded.missing.length} instrument${view.loaded.missing.length === 1 ? '' : 's'}.`));
    nodes.push(
      h('p', { class: 'dim note' }, `Now: average true range over ${atrPeriod} ${timeframe} bars, as a percentage of price. Ratio above 1 means busier than its own ${volatilityBaselineDays}-day average. Each row uses that instrument's latest bar; the newest is ${asOfText(view.loaded, displayZone)} or later.`),
    );
    content.replaceChildren(...nodes);
  });
};
