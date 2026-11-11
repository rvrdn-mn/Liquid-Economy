/** Journal: trade history, statistics, and the trades behind the chart markers. Drawing only. */
import { journalStats, type Tally, type Trade } from '../calc/journal';
import { fileZoneLabel, type FileZone } from '../data/fileZone';
import { formatDateTime, h, zoneLabel } from '../ui/dom';
import { choiceBar, live } from './common';
import type { PanelFactory } from './types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const money = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'up' : 'down');

export const journalPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  let scope: 'all' | 'instrument' = 'all';
  const scopeBar = choiceBar<'all' | 'instrument'>('Trades shown', [{ value: 'all', text: 'ALL' }, { value: 'instrument', text: 'THIS INSTRUMENT' }], (v) => {
    scope = v;
    render();
  });

  const input = h('input', { type: 'file', accept: '.csv,.txt,.htm,.html', class: 'visually-hidden', id: 'journal-input' });
  const choose = h('label', { class: 'button', for: 'journal-input' }, 'Import trade history');
  const zoneChoices: FileZone[] = [0, 'ny-close', 'histdata', ...Array.from({ length: 27 }, (_, i) => (i - 12) * 60).filter((z) => z !== 0)];
  const clock = h('select', { 'aria-label': 'Clock the trade times are written in' });
  for (const z of zoneChoices) clock.append(h('option', { value: String(z) }, fileZoneLabel(z)));
  const readClock = (): FileZone => (clock.value === 'histdata' || clock.value === 'ny-close' ? clock.value : Number(clock.value));
  const result = h('p', { 'aria-live': 'polite' });
  const head = h('div', {});
  const content = h('div', {});
  body.append(head, h('div', { class: 'panel-toolbar' }, choose, input, h('label', {}, 'Trade times are in ', clock)), result, h('div', { class: 'panel-toolbar' }, scopeBar.el), content);

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const { journal, notSaved } = await hub.importJournal(file, readClock());
      result.className = notSaved ? 'warn' : 'ok';
      result.textContent = `${file.name}: ${journal.trades.length} trades read${journal.skipped > 0 ? `, ${journal.skipped} other rows skipped` : ''}.${notSaved ? ` Loaded for this visit only; it could not be saved (${notSaved}).` : ''}`;
    } catch (err) {
      result.className = 'error';
      result.textContent = `${file.name}: ${(err as Error).message}`;
    }
  });

  const tallyTable = (title: string, rows: { label: string; tally: Tally }[]) => {
    const table = h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, title), h('th', { class: 'num' }, 'Trades'), h('th', { class: 'num' }, 'Won'), h('th', { class: 'num' }, 'Net'))));
    const tb = h('tbody', {});
    for (const r of rows) {
      tb.append(h('tr', {}, h('td', {}, r.label), h('td', { class: 'num' }, String(r.tally.trades)), h('td', { class: 'num' }, r.tally.trades > 0 ? `${Math.round((r.tally.wins / r.tally.trades) * 100)}%` : '–'), h('td', { class: `num ${tone(r.tally.net)}` }, money(r.tally.net))));
    }
    table.append(tb);
    return table;
  };

  const stat = (label: string, value: string, cls = '') => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: `stat-value ${cls}` }, value));

  function render(): void {
    const journal = hub.journal;
    const zone = state.settings.displayZone;
    scopeBar.set(scope);
    if (!journal) {
      head.replaceChildren(h('p', { class: 'dim' }, 'No trade history is loaded.'));
      content.replaceChildren();
      footer.textContent = 'No trades';
      return;
    }
    const headLine = h('p', {}, journal.demo ? h('span', { class: 'replay-tag' }, 'DEMO') : null, journal.demo ? ' ' : '', h('span', { class: 'mono' }, journal.label));
    if (!journal.demo) {
      const remove = h('button', { type: 'button', class: 'chip' }, 'Remove');
      remove.addEventListener('click', () => void hub.removeJournal());
      headLine.append(' ', remove);
    }
    head.replaceChildren(headLine);
    if (journal.note) head.append(h('p', { class: 'warn' }, journal.note));

    const instrument = state.settings.instrument;
    const trades = hub.getTrades(scope === 'instrument' ? instrument : undefined);
    const weekdayOf = (t: number) => (zone === 'utc' ? new Date(t * 1000).getUTCDay() : new Date(t * 1000).getDay());
    const s = journalStats(trades, weekdayOf);
    const open = trades.filter((t) => t.closeTime === null).length;

    const nodes: Node[] = [];
    if (trades.length === 0) {
      nodes.push(h('p', { class: 'dim' }, scope === 'instrument' ? `No trades in ${instrument}${hub.replayTime !== null ? ' by the replay moment' : ''}.` : 'No trades by the replay moment.'));
    } else {
      nodes.push(
        h(
          'div',
          { class: 'stats' },
          stat('Closed trades', String(s.trades)),
          stat('Win rate', s.winRate === null ? '–' : `${(s.winRate * 100).toFixed(0)}%`),
          stat('Average win', s.averageWin === null ? '–' : money(s.averageWin), 'up'),
          stat('Average loss', s.averageLoss === null ? '–' : money(s.averageLoss), 'down'),
          stat('Profit factor', s.profitFactor === null ? (s.trades > 0 && s.losses === 0 ? 'no losses' : '–') : s.profitFactor.toFixed(2)),
          stat('Net result', money(s.net), tone(s.net)),
        ),
      );
      const days = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: WEEKDAYS[d]!, tally: s.byWeekday[d]! })).filter((d) => d.tally.trades > 0);
      nodes.push(h('div', { class: 'two-up' }, tallyTable('Session at entry', s.bySession), tallyTable(`Day of entry (${zoneLabel(zone)})`, days)));

      const table = h('table', { class: 'trades' }, h('thead', {}, h('tr', {}, ...['Opened', 'Symbol', 'Side', 'Size', 'Entry', 'Exit', 'Closed'].map((t) => h('th', {}, t)), h('th', { class: 'num' }, 'Result'))));
      const tb = h('tbody', {});
      for (const t of [...trades].reverse()) tb.append(tradeRow(t, zone));
      table.append(tb);
      nodes.push(h('h3', {}, 'Trades, newest first'), table);
      nodes.push(h('p', { class: 'dim note' }, 'Win rate is wins as a share of closed trades. Profit factor is total won divided by total lost. Results include commission and swap where the file lists them, in the file\'s account currency. Session and day are taken from the entry time.'));
    }
    content.replaceChildren(...nodes);
    footer.textContent = [`${trades.length} trade${trades.length === 1 ? '' : 's'}`, open > 0 ? `${open} open` : '', journal.demo ? 'demo journal: invented examples' : journal.label, hub.replayTime !== null ? 'replay' : ''].filter(Boolean).join(' · ');
  }

  const tradeRow = (t: Trade, zone: 'local' | 'utc') => {
    const symbol = t.instrument
      ? (() => {
          const b = h('button', { type: 'button', class: 'link', title: `Chart ${t.instrument}` }, t.instrument);
          b.addEventListener('click', () => ctx.run(`${t.instrument} CHART`));
          return b;
        })()
      : h('span', { class: 'dim', title: 'Not an instrument this app charts' }, t.symbol);
    return h(
      'tr',
      {},
      h('td', {}, formatDateTime(t.openTime, zone)),
      h('td', {}, symbol),
      h('td', { class: t.side === 'buy' ? 'up' : 'down' }, t.side),
      h('td', { class: 'num' }, t.volume === null ? '–' : t.volume.toFixed(2)),
      h('td', { class: 'num' }, String(t.openPrice)),
      h('td', { class: 'num' }, t.closePrice === null ? '–' : String(t.closePrice)),
      h('td', {}, t.closeTime === null ? h('span', { class: 'dim' }, 'open') : formatDateTime(t.closeTime, zone)),
      h('td', { class: `num ${tone(t.result)}` }, t.result === null ? '–' : money(t.result)),
    );
  };

  return live(ctx, () => render());
};
