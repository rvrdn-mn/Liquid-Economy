/** Help panel: every command the bar understands. */
import { PANELS, PANEL_CODES } from '../app/panels';
import { FX_PAIRS } from '../data/instruments';
import { TIMEFRAMES } from '../data/types';
import { h } from '../ui/dom';
import type { PanelFactory } from './types';

export const helpPanel: PanelFactory = (body, footer, ctx) => {
  body.classList.add('scroll');
  const chip = (text: string, title = '') => {
    const b = h('button', { type: 'button', class: 'chip', title }, text);
    b.addEventListener('click', () => ctx.run(text));
    return b;
  };

  const panels = h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Panel'), h('th', {}, 'What it shows'))));
  const tbody = h('tbody', {});
  for (const code of PANEL_CODES) {
    const p = PANELS[code];
    tbody.append(h('tr', {}, h('td', {}, chip(code)), h('td', {}, p.title), h('td', { class: 'wrap' }, p.description, p.pending ? h('span', { class: 'dim' }, ` (${p.pending})`) : null)));
  }
  panels.append(tbody);

  body.append(
    h('h3', {}, 'Command bar'),
    h('p', {}, 'Press ', h('kbd', {}, '/'), ' anywhere, type, then ', h('kbd', {}, 'Enter'), '. ', h('kbd', {}, 'Tab'), ' completes, ', h('kbd', {}, 'Esc'), ' leaves. Several commands can go on one line, for example ', chip('XAU H1'), '.'),
    h('h3', {}, 'Panels'),
    panels,
    h('h3', {}, 'Timeframes'),
    h('p', { class: 'chips' }, ...TIMEFRAMES.map((tf) => chip(tf))),
    h('h3', {}, 'Instruments'),
    h('p', { class: 'chips' }, chip('XAU', 'Gold in US dollars'), ...FX_PAIRS.map((id) => chip(id))),
    h('h3', {}, 'Panels and layout'),
    h('p', {}, 'Drag the line between two panels to resize them. The × in a panel header closes it. The layout, your settings and your imported files are saved in this browser.'),
    h('h3', {}, 'About the data'),
    h('p', {}, 'Every panel says where its data came from and how old it is. Nothing is shown as live unless it is. Missing data is shown as missing.'),
    h('p', { class: 'dim' }, 'For market context only. Not financial advice. Charts by TradingView Lightweight Charts.'),
  );
  footer.textContent = 'Press / to start';
  return { destroy() {} };
};
