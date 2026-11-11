/** Files panel: import price files, see what is loaded, and time settings. */
import type { ImportedSeries } from '../data/fileAdapter';
import type { ImportOutcome } from '../data/hub';
import { fileZoneLabel, type FileZone } from '../data/fileZone';
import { formatAge, formatDate, formatDateTime, h, zoneLabel } from '../ui/dom';
import type { PanelFactory } from './types';

export const filesPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');

  const input = h('input', { type: 'file', accept: '.csv,.txt', multiple: true, class: 'visually-hidden', id: 'file-input' });
  const choose = h('label', { class: 'button', for: 'file-input' }, 'Choose files');
  const zoneChoices: FileZone[] = ['histdata', 'ny-close', ...Array.from({ length: 27 }, (_, i) => (i - 12) * 60)];
  const offset = h('select', { 'aria-label': 'Clock the file was written in' });
  for (const z of zoneChoices) offset.append(h('option', { value: String(z) }, fileZoneLabel(z)));
  const readZone = (): FileZone => (offset.value === 'histdata' || offset.value === 'ny-close' ? offset.value : Number(offset.value));
  offset.addEventListener('change', () => state.update({ importZone: readZone() }));

  const drop = h(
    'div',
    { class: 'dropzone' },
    h('p', {}, 'Drop price files here, or ', choose, input),
    h('p', { class: 'dim' }, 'HistData.com MetaTrader files, MT4 or MT5 exports, TradingView chart exports. Files stay in this browser and are never uploaded.'),
    h('p', {}, h('label', {}, 'File clock ', offset)),
    h('p', { class: 'dim' }, 'A file does not say which clock it uses. A wrong choice shifts every bar by whole hours.'),
  );
  const results = h('div', { class: 'import-results', 'aria-live': 'polite' });
  const imported = h('div', {});
  const samples = h('div', {});

  const zone = h('select', { 'aria-label': 'Show times in' }, h('option', { value: 'local' }, `Local time (${zoneLabel('local')})`), h('option', { value: 'utc' }, 'UTC'));
  zone.addEventListener('change', () => state.update({ displayZone: zone.value as 'local' | 'utc' }));
  const roll = h('select', { 'aria-label': 'Trading day starts at' }, h('option', { value: 'ny17' }, '17:00 New York'), h('option', { value: 'utc' }, 'Midnight UTC'));
  roll.addEventListener('change', () => state.update({ dayRoll: roll.value as 'ny17' | 'utc' }));
  const liveBox = h('input', { type: 'checkbox' });
  liveBox.addEventListener('change', () => state.update({ liveGold: liveBox.checked }));
  const settings = h(
    'div',
    { class: 'settings' },
    h('h3', {}, 'Time'),
    h('p', {}, h('label', {}, 'Show times in ', zone)),
    h('p', {}, h('label', {}, 'Trading day starts at ', roll)),
    h('p', { class: 'dim' }, 'The trading day setting affects four-hour and daily bars built from finer files.'),
    h('h3', {}, 'Live gold'),
    h('p', {}, h('label', {}, liveBox, ' Show the live gold price from gold-api.com')),
    h('p', { class: 'dim' }, 'When on, this browser asks gold-api.com for the price every 30 seconds while the tab is visible. Nothing about you is sent beyond the request itself.'),
  );

  const riskInput = h('input', { type: 'file', accept: '.csv,.txt', class: 'visually-hidden', id: 'risk-input' });
  const riskChoose = h('label', { class: 'button', for: 'risk-input' }, 'Choose risk-mood file');
  const riskStatus = h('div', {});
  const riskResult = h('p', { 'aria-live': 'polite' });
  const yieldStatus = h('p', {});
  const driverBox = h(
    'div',
    {},
    h('h3', {}, 'Gold driver data'),
    yieldStatus,
    riskStatus,
    h('p', {}, riskChoose, riskInput),
    riskResult,
    h('p', { class: 'dim' }, 'Risk mood is any daily "date, value" file, for example a volatility index or share index history. It stays in this browser.'),
  );
  riskInput.addEventListener('change', async () => {
    const file = riskInput.files?.[0];
    riskInput.value = '';
    if (!file) return;
    try {
      const { series, notSaved } = await hub.importRiskFile(file);
      riskResult.className = notSaved ? 'warn' : 'ok';
      riskResult.textContent = `${file.name}: ${series.points.length} daily values.${notSaved ? ` Loaded for this visit only; it could not be saved (${notSaved}).` : ''}`;
    } catch (err) {
      riskResult.className = 'error';
      riskResult.textContent = `${file.name}: ${(err as Error).message}`;
    }
  });

  body.append(drop, results, h('h3', {}, 'Your files'), imported, driverBox, h('h3', {}, 'Sample set'), samples, settings);

  const handle = async (files: File[]) => {
    if (files.length === 0) return;
    results.replaceChildren(h('p', { class: 'dim' }, `Reading ${files.length} file${files.length === 1 ? '' : 's'}...`));
    const outcomes = await hub.importFiles(files, state.settings.importZone);
    results.replaceChildren(...outcomes.map(outcomeLine));
    const first = outcomes.find((o) => o.result)?.result;
    if (first) {
      // Show what was just imported, at its finest chartable timeframe.
      const tf = first.serves.includes(state.settings.timeframe) ? state.settings.timeframe : first.serves[0];
      state.update({ instrument: first.series.instrument, ...(tf ? { timeframe: tf } : {}) });
    }
  };

  const outcomeLine = (o: ImportOutcome): HTMLElement => {
    if (o.error || !o.result) return h('p', { class: 'error' }, `${o.fileName}: ${o.error ?? 'could not be read'}`);
    const { series, parsed, serves } = o.result;
    const bits = [`${o.fileName}: ${series.bars.length} ${series.timeframe} bars for ${series.instrument}, serves ${serves.join(' ')}.`];
    if (parsed.skipped.length > 0) {
      const first = parsed.skipped.slice(0, 3).map((s) => `line ${s.line} (${s.reason})`).join(', ');
      bits.push(`${parsed.skipped.length} row${parsed.skipped.length === 1 ? '' : 's'} skipped: ${first}.`);
    }
    if (parsed.duplicates > 0) bits.push(`${parsed.duplicates} rows shared a timestamp and were combined.`);
    if (o.notSaved) bits.push(`Loaded for this visit only; it could not be saved in the browser (${o.notSaved}).`);
    return h('p', { class: parsed.skipped.length > 0 || o.notSaved ? 'warn' : 'ok' }, bits.join(' '));
  };

  input.addEventListener('change', () => {
    void handle([...(input.files ?? [])]);
    input.value = '';
  });
  drop.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('over');
    void handle([...(ev.dataTransfer?.files ?? [])]);
  });

  const range = (s: ImportedSeries) => {
    const first = s.bars[0]!.time;
    const last = s.bars[s.bars.length - 1]!.time;
    return s.barSeconds >= 86400
      ? `${formatDate(first)} to ${formatDate(last)}`
      : `${formatDateTime(first, state.settings.displayZone)} to ${formatDateTime(last, state.settings.displayZone)}`;
  };

  const render = () => {
    zone.value = state.settings.displayZone;
    roll.value = state.settings.dayRoll;
    liveBox.checked = state.settings.liveGold;
    offset.value = String(state.settings.importZone);

    const mine = hub.importedFiles();
    if (mine.length === 0) {
      imported.replaceChildren(h('p', { class: 'dim' }, 'None yet. Intraday charts need a file from you.'));
    } else {
      const table = h('table', {}, h('thead', {}, h('tr', {}, ...['Instrument', 'Bars', 'Range', ''].map((t) => h('th', {}, t)))));
      const tbody = h('tbody', {});
      for (const s of mine) {
        const remove = h('button', { type: 'button', class: 'chip', title: `Remove ${s.source.label}` }, 'Remove');
        remove.addEventListener('click', () => void hub.removeFile(s));
        const open = h('button', { type: 'button', class: 'link' }, s.instrument);
        open.addEventListener('click', () => ctx.run(`${s.instrument} CHART`));
        tbody.append(
          h('tr', { title: s.source.label }, h('td', {}, open), h('td', {}, `${s.bars.length} ${s.timeframe}`), h('td', { class: 'wrap-mono' }, `${range(s)}, ${formatAge(s.source.asOf)}`), h('td', {}, remove)),
        );
      }
      table.append(tbody);
      imported.replaceChildren(table);
    }

    const yld = hub.driverInfo('yield');
    yieldStatus.textContent = yld
      ? `10-year yield: ${yld.points.length} days to ${formatDate(yld.source.asOf)}, ${yld.source.label}.${yld.source.note ? ' ' + yld.source.note : ''}`
      : '10-year yield: not loaded.';
    const risk = hub.driverInfo('risk');
    if (risk) {
      const remove = h('button', { type: 'button', class: 'chip' }, 'Remove');
      remove.addEventListener('click', () => void hub.removeRiskFile());
      riskStatus.replaceChildren(h('p', {}, `${risk.label}: ${risk.points.length} days, ${formatDate(risk.points[0]!.time)} to ${formatDate(risk.source.asOf)} `, remove));
    } else {
      riskStatus.replaceChildren(h('p', { class: 'dim' }, 'Risk mood: none loaded.'));
    }

    const sampleList = hub.sampleFiles();
    const m = hub.sampleManifest;
    if (!m || sampleList.length === 0) {
      samples.replaceChildren(h('p', { class: 'dim' }, 'Not loaded.'));
    } else {
      const s0 = sampleList[0]!;
      samples.replaceChildren(
        h('p', {}, `${sampleList.length} instruments, daily, ${range(s0)}.`),
        h('p', { class: 'dim' }, `${m.source}. ${m.description}`),
      );
    }
    const errors = hub.startupErrors.map((e) => h('p', { class: 'error' }, e));
    if (errors.length > 0) samples.append(...errors);
    footer.textContent = `${mine.length} imported file${mine.length === 1 ? '' : 's'} · kept in this browser only`;
  };

  const offData = hub.onChange(render);
  const offSettings = state.onSettings(render);
  render();
  return {
    destroy() {
      offData();
      offSettings();
    },
  };
};
