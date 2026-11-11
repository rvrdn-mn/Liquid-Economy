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

  const REPO = 'https://github.com/rvrdn-mn/Liquid-Economy';
  const doc = (text: string, path: string) => h('a', { href: `${REPO}/blob/main/${path}`, target: '_blank', rel: 'noopener noreferrer' }, text);

  body.append(
    h('h3', {}, 'Getting started'),
    h('p', {}, 'Everything you see at first runs on the sample set: one reference rate per day for gold and the 28 major pairs. That is enough for the strength board, the weather map, the gold drivers and the liquid machine.'),
    h('p', {}, 'The sidebar has the pages: Overview, Currencies and Gold for analysis; Journal and News; Data for importing files. The instrument and timeframe at the top apply to every page. Replay, also at the top, rewinds every panel to a past moment.'),
    h('p', {}, 'For intraday charts, real volatility and the session profile, import one-minute price files on the Data page. Files for XAUUSD and the seven dollar pairs cover everything. The small "i" on a panel explains how to read it.'),
    h('h3', {}, 'Command bar'),
    h('p', {}, 'Press ', h('kbd', {}, '/'), ' anywhere, type, then ', h('kbd', {}, 'Enter'), '. ', h('kbd', {}, 'Tab'), ' completes, ', h('kbd', {}, 'Esc'), ' leaves. Several commands can go on one line, for example ', chip('XAU H1'), '.'),
    h('h3', {}, 'Panels'),
    panels,
    h('h3', {}, 'Timeframes'),
    h('p', { class: 'chips' }, ...TIMEFRAMES.map((tf) => chip(tf))),
    h('h3', {}, 'Instruments'),
    h('p', { class: 'chips' }, chip('XAU', 'Gold in US dollars'), ...FX_PAIRS.map((id) => chip(id))),
    h('h3', {}, 'Panels and layout'),
    h('p', {}, 'Drag the gap between two panels to resize them. The × on a panel closes it, and typing its code brings it back. Each page keeps its own arrangement. Pages, settings and imported files are saved in this browser.'),
    h('h3', {}, 'About the data'),
    h('p', {}, 'Every panel says where its data came from and how old it is. Nothing is shown as live unless it is. Missing data is shown as missing.'),
    h('p', {}, 'How each number is calculated: ', doc('calculations', 'docs/CALCULATIONS.md'), '. Where the data comes from, its delay and its terms: ', doc('data sources', 'docs/DATA_SOURCES.md'), '. Credits and licences: ', doc('third-party notices', 'THIRD_PARTY_NOTICES.md'), '.'),
    h('p', { class: 'dim' }, 'For market context only. Not financial advice. No buy or sell signals, no predictions. Charts by TradingView Lightweight Charts; map outlines from Natural Earth.'),
  );
  footer.textContent = 'Press / to start';
  return { destroy() {} };
};
