/** Instrument picker: a button that opens a searchable list, so nothing has to be typed from memory. */
import type { AppState } from '../app/state';
import type { DataHub } from '../data/hub';
import { FX_PAIRS, GOLD } from '../data/instruments';
import type { InstrumentId } from '../data/types';
import { h } from './dom';
import { icon } from './icons';

export const prettySymbol = (id: InstrumentId) => `${id.slice(0, 3)}/${id.slice(3)}`;

export function createInstrumentPicker(state: AppState, hub: DataHub): HTMLElement {
  const label = h('span', { class: 'picker-symbol' });
  const button = h('button', { type: 'button', class: 'picker-button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', title: 'Choose an instrument' }, label, icon('chevron', 14));
  const search = h('input', { type: 'text', class: 'picker-search', placeholder: 'Search, e.g. EUR or JPY', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search instruments' });
  const list = h('div', { class: 'picker-list', role: 'listbox' });
  const popover = h('div', { class: 'picker-popover', hidden: true }, search, list);
  const root = h('div', { class: 'picker' }, button, popover);

  const groups: { title: string; ids: InstrumentId[] }[] = [
    { title: 'Gold', ids: [GOLD] },
    { title: 'Dollar pairs', ids: FX_PAIRS.filter((p) => p.includes('USD')) },
    { title: 'Crosses', ids: FX_PAIRS.filter((p) => !p.includes('USD')) },
  ];

  const close = () => {
    popover.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const pick = (id: InstrumentId) => {
    state.update({ instrument: id });
    close();
    button.focus();
  };

  const renderList = () => {
    const q = search.value.toUpperCase().replace(/[^A-Z]/g, '');
    const intraday = new Set(hub.importedFiles().map((f) => f.instrument));
    list.replaceChildren();
    let first: InstrumentId | null = null;
    for (const g of groups) {
      const ids = g.ids.filter((id) => q === '' || id.includes(q) || (id === GOLD && 'GOLD'.includes(q)));
      if (ids.length === 0) continue;
      list.append(h('div', { class: 'picker-group' }, g.title));
      for (const id of ids) {
        first ??= id;
        const option = h('button', { type: 'button', class: `picker-option ${id === state.settings.instrument ? 'selected' : ''}`, role: 'option' }, h('span', {}, prettySymbol(id)), intraday.has(id) ? h('span', { class: 'picker-tag', title: 'You have imported a file for this instrument' }, 'your file') : null);
        option.addEventListener('click', () => pick(id));
        list.append(option);
      }
    }
    if (!first) list.append(h('p', { class: 'picker-empty' }, 'No instrument matches. There are gold and the 28 pairs of the eight major currencies.'));
    return first;
  };

  button.addEventListener('click', () => {
    if (!popover.hidden) return close();
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    search.value = '';
    renderList();
    search.focus();
  });
  search.addEventListener('input', renderList);
  search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      close();
      button.focus();
    } else if (ev.key === 'Enter') {
      const first = renderList();
      if (first) pick(first);
    }
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!popover.hidden && !root.contains(ev.target as Node)) close();
  });

  const sync = () => {
    label.textContent = prettySymbol(state.settings.instrument);
    label.classList.toggle('gold', state.settings.instrument === GOLD);
  };
  state.onSettings(sync);
  sync();
  return root;
}
