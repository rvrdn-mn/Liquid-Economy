/** News: press-release headlines from central banks, each a link back to the bank. Drawing only. */
import { CURRENCIES } from '../data/types';
import { formatAge, formatDateTime, h, zoneLabel } from '../ui/dom';
import { choiceBar, live } from './common';
import type { PanelFactory } from './types';

export const newsPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  let filter = 'instrument';
  const bar = h('div', {});
  const content = h('div', {});
  body.append(bar, content);

  function render(): void {
    const news = hub.news();
    const zone = state.settings.displayZone;
    const instrument = state.settings.instrument;
    if (!news) {
      bar.replaceChildren();
      content.replaceChildren(h('div', { class: 'panel-empty' }, h('p', { class: 'empty-title' }, 'No headlines are available.'), h('p', { class: 'dim' }, 'The headline file was not found. It is written when the site is built.')));
      footer.textContent = 'No headlines';
      return;
    }
    const covered = news.sources.map((s) => s.currency);
    const wanted = instrument === 'XAUUSD' ? ['USD'] : [instrument.slice(0, 3), instrument.slice(3, 6)];
    const choices = [{ value: 'instrument', text: `FOR ${instrument}` }, { value: 'all', text: 'ALL' }, ...covered.map((c) => ({ value: c, text: c }))];
    if (!choices.some((c) => c.value === filter)) filter = 'instrument';
    const picker = choiceBar<string>('Headlines shown', choices, (v) => {
      filter = v;
      render();
    });
    picker.set(filter);
    bar.replaceChildren(h('div', { class: 'panel-toolbar' }, picker.el));

    const show = filter === 'all' ? covered : filter === 'instrument' ? wanted : [filter];
    const items = news.items.filter((i) => show.includes(i.currency));
    const names = new Map(news.sources.map((s) => [s.id, s.name]));
    const nodes: Node[] = [];
    const uncovered = (filter === 'instrument' ? wanted : filter === 'all' ? [...CURRENCIES] : []).filter((c) => !covered.includes(c));

    if (items.length === 0) {
      nodes.push(h('p', { class: 'dim' }, hub.replayTime !== null ? 'No headlines from these banks had been published by the replay moment that are still in the copied list.' : 'No headlines for this selection.'));
    } else {
      const table = h('table', { class: 'news' });
      const tb = h('tbody', {});
      for (const i of items) {
        const link = h('a', { href: i.link, target: '_blank', rel: 'noopener noreferrer' }, i.title);
        tb.append(h('tr', {}, h('td', { class: 'dim' }, formatDateTime(i.time, zone)), h('td', { class: 'ccy-tag' }, i.currency), h('td', { class: 'wrap' }, link, h('span', { class: 'dim' }, ` · ${names.get(i.source) ?? i.source}`))));
      }
      table.append(tb);
      nodes.push(table);
    }
    if (uncovered.length > 0) {
      nodes.push(h('p', { class: 'warn note' }, `No headline source for ${uncovered.join(', ')}. A bank is included only when its own terms allow its headlines to be shown here; see the data sources page.`));
    }
    if (instrument === 'XAUUSD' && filter === 'instrument') nodes.push(h('p', { class: 'dim note' }, 'There is no gold-specific source; gold is shown with US dollar headlines.'));
    const failed = news.sources.filter((s) => s.error);
    if (failed.length > 0) nodes.push(h('p', { class: 'dim note' }, `Could not be reached at the last copy: ${failed.map((s) => s.name).join(', ')}.`));
    nodes.push(h('p', { class: 'dim note' }, `Headlines are the banks' own press releases: ${news.sources.map((s) => s.name).join(', ')}. Only the title, date and link are copied. Times are in ${zoneLabel(zone)}. These are official announcements, not market commentary.`));
    content.replaceChildren(...nodes);
    footer.textContent = [`${items.length} headline${items.length === 1 ? '' : 's'}`, `copied from the banks ${formatAge(news.fetchedAt).replace(' old', ' ago')}`, hub.replayTime !== null ? 'replay' : ''].filter(Boolean).join(' · ');
  }

  return live(ctx, () => render());
};
