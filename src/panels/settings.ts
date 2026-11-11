/** Settings: every adjustable default in one place, plus layout and stored data. */
import { DEFAULT_SETTINGS, type Settings } from '../app/state';
import { fileZoneLabel, type FileZone } from '../data/fileZone';
import { INSTRUMENTS } from '../data/instruments';
import { h, zoneLabel } from '../ui/dom';
import { live } from './common';
import type { PanelFactory } from './types';

type NumberKey = 'strengthLookbackHours' | 'atrPeriod' | 'volatilityBaselineDays' | 'sessionProfileDays' | 'correlationWindow' | 'correlationThreshold' | 'driverWindow';

const NUMBERS: { key: NumberKey; label: string; unit: string; min: number; max: number; step: number; used: string }[] = [
  { key: 'strengthLookbackHours', label: 'Strength lookback', unit: 'hours', min: 1, max: 8784, step: 1, used: 'Strength board, weather map' },
  { key: 'atrPeriod', label: 'Range average', unit: 'bars', min: 2, max: 200, step: 1, used: 'Volatility, weather map storms' },
  { key: 'volatilityBaselineDays', label: 'Volatility baseline', unit: 'days', min: 2, max: 366, step: 1, used: 'Volatility, weather map storms' },
  { key: 'sessionProfileDays', label: 'Session profile', unit: 'days', min: 2, max: 366, step: 1, used: 'Session clock' },
  { key: 'correlationWindow', label: 'Linked-pairs window', unit: 'bars', min: 5, max: 1000, step: 1, used: 'Linked pairs' },
  { key: 'correlationThreshold', label: 'Linked-pairs flag level', unit: '', min: 0.05, max: 0.99, step: 0.05, used: 'Linked pairs' },
  { key: 'driverWindow', label: 'Gold-driver window', unit: 'daily bars', min: 5, max: 500, step: 1, used: 'Gold drivers, liquid machine' },
];

export const settingsPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');

  // --- time
  const zone = h('select', { id: 'set-zone' }, h('option', { value: 'local' }, `Local time (${zoneLabel('local')})`), h('option', { value: 'utc' }, 'UTC'));
  zone.addEventListener('change', () => state.update({ displayZone: zone.value as Settings['displayZone'] }));
  const roll = h('select', { id: 'set-roll' }, h('option', { value: 'ny17' }, '17:00 New York'), h('option', { value: 'utc' }, 'Midnight UTC'));
  roll.addEventListener('change', () => state.update({ dayRoll: roll.value as Settings['dayRoll'] }));
  const zoneChoices: FileZone[] = ['histdata', 'ny-close', ...Array.from({ length: 27 }, (_, i) => (i - 12) * 60)];
  const clock = h('select', { id: 'set-clock' });
  for (const z of zoneChoices) clock.append(h('option', { value: String(z) }, fileZoneLabel(z)));
  clock.addEventListener('change', () => state.update({ importZone: clock.value === 'histdata' || clock.value === 'ny-close' ? clock.value : Number(clock.value) }));
  const liveBox = h('input', { type: 'checkbox', id: 'set-live' });
  liveBox.addEventListener('change', () => state.update({ liveGold: liveBox.checked }));

  // --- calculation defaults
  const inputs = new Map<NumberKey, HTMLInputElement>();
  const calcRows = NUMBERS.map((n) => {
    const input = h('input', { type: 'number', id: `set-${n.key}`, min: String(n.min), max: String(n.max), step: String(n.step), class: 'num-input' });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      // Out-of-range or empty entries are put back rather than half-applied.
      if (input.value.trim() === '' || !Number.isFinite(v) || v < n.min || v > n.max || (n.step === 1 && !Number.isInteger(v))) {
        input.value = String(state.settings[n.key]);
        input.classList.add('invalid');
        setTimeout(() => input.classList.remove('invalid'), 900);
        return;
      }
      state.update({ [n.key]: v } as Partial<Settings>);
    });
    inputs.set(n.key, input);
    return h('tr', {}, h('td', { class: 'wrap' }, h('label', { for: `set-${n.key}` }, n.label)), h('td', {}, input, h('span', { class: 'dim' }, ` ${n.unit}`)), h('td', { class: 'dim wrap' }, `${n.min} to ${n.max}, default ${DEFAULT_SETTINGS[n.key]}`), h('td', { class: 'dim wrap' }, n.used));
  });
  const resetCalc = h('button', { type: 'button', class: 'button' }, 'Put all settings back to their defaults');
  resetCalc.addEventListener('click', () => state.resetSettings());

  // --- watchlist
  const boxes = new Map<string, HTMLInputElement>();
  const watchNote = h('span', { class: 'dim' });
  const watch = h('div', { class: 'watchlist' });
  for (const id of INSTRUMENTS) {
    const box = h('input', { type: 'checkbox' });
    box.addEventListener('change', () => {
      const next = INSTRUMENTS.filter((i) => boxes.get(i)!.checked);
      if (next.length < 2) {
        box.checked = true; // a grid needs at least two instruments
        watchNote.textContent = ' At least two are needed.';
        return;
      }
      watchNote.textContent = '';
      state.update({ watchlist: [...next] });
    });
    boxes.set(id, box);
    watch.append(h('label', { class: 'watch-item' }, box, ` ${id === 'XAUUSD' ? 'XAU' : id}`));
  }

  // --- layout and stored data
  const resetLayout = h('button', { type: 'button', class: 'button' }, 'Restore every page to its starting arrangement');
  resetLayout.addEventListener('click', () => state.resetAllLayouts());
  const clear = h('button', { type: 'button', class: 'button' }, 'Remove everything I imported');
  const stored = h('p', { class: 'dim' });
  let armed = false;
  clear.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      clear.textContent = 'Click again to remove price files, risk-mood file and trade history';
      clear.classList.add('danger');
      setTimeout(() => {
        armed = false;
        clear.textContent = 'Remove everything I imported';
        clear.classList.remove('danger');
      }, 5000);
      return;
    }
    armed = false;
    clear.textContent = 'Remove everything I imported';
    clear.classList.remove('danger');
    await hub.clearImported();
  });

  const row = (label: string, forId: string, control: HTMLElement, hint: string) => h('tr', {}, h('td', { class: 'wrap' }, h('label', { for: forId }, label)), h('td', {}, control), h('td', { class: 'dim wrap' }, hint));

  body.append(
    h('h3', {}, 'Time'),
    h('table', { class: 'settings-table' }, h('tbody', {}, row('Show times in', 'set-zone', zone, 'Stored times are always UTC; this only changes how they are shown.'), row('Trading day starts at', 'set-roll', roll, 'Used when four-hour and daily bars are built from finer files.'), row('Clock of imported price files', 'set-clock', clock, 'A file does not say which clock it uses. Also offered when importing.'))),
    h('h3', {}, 'Live data'),
    h('p', {}, h('label', {}, liveBox, ' Show the live gold price from gold-api.com (asked every 30 seconds while this tab is visible)')),
    h('h3', {}, 'Calculation defaults'),
    h('table', { class: 'settings-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Setting'), h('th', {}, 'Value'), h('th', {}, 'Allowed'), h('th', {}, 'Used by'))), h('tbody', {}, ...calcRows)),
    h('p', {}, resetCalc),
    h('h3', {}, 'Watchlist for linked pairs'),
    watch,
    h('p', {}, watchNote),
    h('h3', {}, 'Pages'),
    h('p', {}, resetLayout),
    h('h3', {}, 'Stored in this browser'),
    stored,
    h('p', {}, clear),
    h('p', { class: 'dim' }, 'Settings, layout and imported files are kept in this browser only. Nothing is uploaded. The sample set and the demo journal are part of the app and cannot be removed.'),
  );

  return live(ctx, () => {
    const s = state.settings;
    zone.value = s.displayZone;
    roll.value = s.dayRoll;
    clock.value = String(s.importZone);
    liveBox.checked = s.liveGold;
    for (const n of NUMBERS) {
      const input = inputs.get(n.key)!;
      if (document.activeElement !== input) input.value = String(s[n.key]);
    }
    for (const [id, box] of boxes) box.checked = s.watchlist.includes(id);
    const files = hub.importedFiles().length;
    const parts = [`${files} price file${files === 1 ? '' : 's'}`, hub.driverInfo('risk') ? 'a risk-mood file' : 'no risk-mood file', hub.journal && !hub.journal.demo ? 'your trade history' : 'no trade history of your own'];
    stored.textContent = `Imported: ${parts.join(', ')}.`;
    const changed = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => k !== 'instrument' && k !== 'timeframe' && JSON.stringify(s[k]) !== JSON.stringify(DEFAULT_SETTINGS[k])).length;
    footer.textContent = changed === 0 ? 'All settings at their defaults' : `${changed} setting${changed === 1 ? '' : 's'} changed from the default`;
  });
};
