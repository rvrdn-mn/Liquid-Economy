/** Gold drivers: how the dollar, the 10-year yield and risk mood are moving with gold. Drawing only. */
import { driversView, type DriverRow } from '../app/analysis';
import { formatDate, h } from '../ui/dom';
import { choiceBar, emptyState, live } from './common';
import { DIRECTION_COLORS, DIRECTION_WORDS } from './liquid/model';
import type { PanelFactory } from './types';

const WINDOWS = [
  { value: 20, text: '20' },
  { value: 30, text: '30' },
  { value: 60, text: '60' },
] as const;

const signed = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

/** A driver's latest value and its change on the day, written in its own units. */
export function describeMove(row: Pick<DriverRow, 'id' | 'unit' | 'kind' | 'latest'>): { value: string; change: string; up: boolean | null } {
  if (!row.latest) return { value: '–', change: '–', up: null };
  const { value, change } = row.latest;
  const up = change === 0 ? null : change > 0;
  if (row.kind === 'difference') return { value: `${value.toFixed(2)}${row.unit}`, change: `${signed(change, 2)} pts`, up };
  return { value: value.toFixed(2), change: `${signed(change, 2)}%`, up };
}

export const driversPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  const windowBar = choiceBar<number>('Window in daily bars', WINDOWS, (bars) => state.update({ driverWindow: bars }));
  const content = h('div', {});
  body.append(h('div', { class: 'panel-toolbar' }, h('span', { class: 'dim' }, 'Window'), windowBar.el, h('span', { class: 'dim' }, 'daily bars')), content);

  return live(ctx, async (current) => {
    const { driverWindow } = state.settings;
    windowBar.set(driverWindow);
    const view = await driversView(hub, driverWindow);
    if (!current()) return;
    if (!view.gold) {
      content.replaceChildren(emptyState('Gold drivers cannot be shown.', view.reason ?? '', { label: 'Import files', run: () => ctx.run('FILES') }));
      footer.textContent = 'No data loaded for this view.';
      return;
    }

    const table = h(
      'table',
      { class: 'drivers' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Driver'), h('th', { class: 'num' }, 'Latest'), h('th', { class: 'num' }, 'On the day'), h('th', {}, 'Link with gold'), h('th', { class: 'num' }, 'Since yesterday'))),
    );
    const tbody = h('tbody', {});
    const goldMove = view.gold.latest;
    tbody.append(
      h(
        'tr',
        { class: 'gold-row' },
        h('td', { class: 'driver-name' }, 'Gold'),
        h('td', { class: 'num' }, goldMove ? goldMove.value.toFixed(2) : '–'),
        h('td', { class: `num ${goldMove ? (goldMove.change > 0 ? 'up' : goldMove.change < 0 ? 'down' : '') : ''}` }, goldMove ? `${signed(goldMove.change, 2)}%` : '–'),
        h('td', { class: 'dim' }, ''),
        h('td', { class: 'num dim' }, ''),
      ),
    );
    for (const row of view.rows) {
      if (!row.available) {
        tbody.append(h('tr', { 'data-driver': row.id }, h('td', { class: 'driver-name' }, row.id === 'risk' ? 'Risk mood' : row.label), h('td', { class: 'wrap dim', colspan: '4' }, row.reason ?? 'No data.')));
        continue;
      }
      const move = describeMove(row);
      const link = row.link!;
      const swatch = h('span', { class: 'swatch', 'aria-hidden': 'true' });
      swatch.style.background = `rgb(${DIRECTION_COLORS[row.direction].join(',')})`;
      const delta = link.r !== null && link.rPrevious !== null ? link.r - link.rPrevious : null;
      const trend = link.r === null || link.rPrevious === null ? '' : Math.abs(link.r) > Math.abs(link.rPrevious) ? 'stronger' : Math.abs(link.r) < Math.abs(link.rPrevious) ? 'weaker' : 'unchanged';
      tbody.append(
        h(
          'tr',
          { 'data-driver': row.id, title: [row.sourceLabel, row.note].filter(Boolean).join('. ') },
          h('td', { class: 'driver-name' }, row.label),
          h('td', { class: 'num' }, move.value),
          h('td', { class: `num ${move.up === null ? '' : move.up ? 'up' : 'down'}` }, move.change),
          h(
            'td',
            { class: 'link-cell', title: link.r === null ? `Needs ${driverWindow} shared days of changes; has ${link.n}` : `Over the last ${driverWindow} of ${link.n} shared days` },
            link.r === null ? h('span', { class: 'dim' }, `needs ${driverWindow} days, has ${link.n}`) : h('span', { class: 'link-value' }, swatch, h('span', { class: 'link-r' }, signed(link.r, 2)), h('span', { class: 'dim' }, ` ${DIRECTION_WORDS[row.direction]}`)),
          ),
          h('td', { class: 'num' }, delta === null ? '–' : `${signed(delta, 2)} `, delta === null ? null : h('span', { class: 'dim' }, trend)),
        ),
      );
    }
    table.append(tbody);

    const nodes: Node[] = [table];
    if (view.gold.closeOnly) {
      nodes.push(h('p', { class: 'warn note' }, `Gold here is the sample set's daily reference rate, which trails the market by about a day, so these links are understated. Import gold price files covering more than ${driverWindow + 3} days for a truer reading.`));
    }
    for (const row of view.rows) if (row.available && row.note) nodes.push(h('p', { class: 'dim note' }, `${row.label}: ${row.note}`));
    nodes.push(
      h('p', { class: 'dim note' }, `Link: correlation of gold's daily percentage change with each driver's daily change over the last ${driverWindow} days both have. Blue is moving with gold (toward +1), purple against it (toward −1). The dollar is this app's own measure: its average daily move against the other seven majors, as an index starting at 100. The yield's change is in percentage points.`),
    );
    content.replaceChildren(...nodes);

    const lastDay = Math.max(...view.rows.map((r) => r.link?.lastTime ?? 0), view.gold.latest?.time ?? 0);
    footer.textContent = ['D1', `${driverWindow}-day window`, lastDay > 0 ? `to ${formatDate(lastDay)}` : '', view.replay ? 'replay' : '', `gold: ${view.gold.sourceLabel}`].filter(Boolean).join(' · ');
  });
};
