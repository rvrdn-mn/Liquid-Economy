/** Wires the app together: pages, header controls, panel grid and data. */
import './style.css';
import type { Command } from './app/commands';
import { findPanel, openPanel } from './app/layout';
import type { PanelCode } from './app/panels';
import { AppState } from './app/state';
import { homeWorkspace, WORKSPACES } from './app/workspaces';
import { GOLD_POLL_SECONDS, GOLD_STALE_SECONDS } from './data/goldApi';
import { DataHub } from './data/hub';
import { TIMEFRAMES } from './data/types';
import { chartPanel } from './panels/chart';
import { onProblem } from './panels/common';
import { driversPanel } from './panels/drivers';
import { filesPanel } from './panels/files';
import { helpPanel } from './panels/help';
import { journalPanel } from './panels/journal';
import { labPanel } from './panels/lab';
import { linksPanel } from './panels/links';
import { liquidPanel } from './panels/liquid';
import { newsPanel } from './panels/news';
import { placeholderPanel } from './panels/placeholder';
import { sessionPanel } from './panels/session';
import { settingsPanel } from './panels/settings';
import { strengthPanel } from './panels/strength';
import type { PanelContext, PanelFactory } from './panels/types';
import { volatilityPanel } from './panels/volatility';
import { weatherPanel } from './panels/weather';
import { CommandBar } from './ui/commandBar';
import { formatAge, formatDateTime, h, zoneLabel } from './ui/dom';
import { Grid } from './ui/grid';
import { icon } from './ui/icons';
import { createInstrumentPicker } from './ui/instrumentPicker';
import { createReplayBar } from './ui/replayBar';
import { createSidebar } from './ui/sidebar';

const state = new AppState();
const hub = new DataHub();
hub.setDayRoll(state.settings.dayRoll);
state.onSettings(() => hub.setDayRoll(state.settings.dayRoll));

const built: Partial<Record<PanelCode, PanelFactory>> = {
  CHART: chartPanel,
  FILES: filesPanel,
  HELP: helpPanel,
  STR: strengthPanel,
  VOL: volatilityPanel,
  SES: sessionPanel,
  LINK: linksPanel,
  WX: weatherPanel,
  DRV: driversPanel,
  LIQ: liquidPanel,
  JRN: journalPanel,
  NEWS: newsPanel,
  SET: settingsPanel,
  LAB: labPanel,
};
const factories = (code: PanelCode): PanelFactory => built[code] ?? placeholderPanel(code);

let grid: Grid | null = null;

/**
 * Bring a panel into view. If it is on this page it is pointed out; if it
 * lives on another page, that page is opened; otherwise it is added here.
 */
function show(code: PanelCode): void {
  const here = findPanel(state.layout, code);
  if (here) return grid?.flash(here.id);
  const home = homeWorkspace(code);
  const there = home ? findPanel(state.layoutOf(home), code) : undefined;
  if (home && there) {
    state.setWorkspace(home);
    grid?.flash(there.id);
    return;
  }
  const { layout, id } = openPanel(state.layout, code);
  state.setLayout(layout);
  grid?.flash(id);
}

/** A chart is wanted: stay if this page has one, else go to the first page that does. */
function showChart(): void {
  if (findPanel(state.layout, 'CHART')) return;
  state.setWorkspace(findPanel(state.layoutOf('overview'), 'CHART') ? 'overview' : 'journal');
  if (!findPanel(state.layout, 'CHART')) show('CHART');
}

function execute(commands: Command[]): void {
  for (const c of commands) {
    if (c.kind === 'instrument') {
      state.update({ instrument: c.instrument });
      showChart();
    } else if (c.kind === 'timeframe') {
      state.update({ timeframe: c.timeframe });
      showChart();
    } else if (c.kind === 'page') {
      state.setWorkspace(c.page);
    } else if (c.kind === 'panel') {
      if (c.code === 'RPL') replay.toggle();
      else show(c.code);
    }
  }
}

const bar = new CommandBar({ execute });
const ctx: PanelContext = { state, hub, run: (text) => bar.run(text) };

// ---------------------------------------------------------------- header

const pageTitle = h('h1', { class: 'page-title' });
const pageSummary = h('span', { class: 'page-summary' });

const tfButtons = TIMEFRAMES.map((tf) => {
  const b = h('button', { type: 'button', class: 'seg' }, tf);
  b.addEventListener('click', () => state.update({ timeframe: tf }));
  return [tf, b] as const;
});
const timeframes = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Timeframe' }, ...tfButtons.map(([, b]) => b));
const syncTimeframes = () => {
  const available = new Set(hub.availableTimeframes(state.settings.instrument));
  for (const [tf, b] of tfButtons) {
    const on = tf === state.settings.timeframe;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('unavailable', hub.ready && !available.has(tf));
    b.title = hub.ready && !available.has(tf) ? `No ${tf} data for this instrument. Import a price file in Data.` : '';
  }
};

const replayButton = h('button', { type: 'button', class: 'btn header-btn', title: 'Rewind every panel to a past moment' }, icon('replay', 15), h('span', {}, 'Replay'));
const replay = createReplayBar(state, hub, () => {
  replayButton.classList.toggle('active', replay.isOpen());
  replayButton.setAttribute('aria-pressed', String(replay.isOpen()));
});
replayButton.addEventListener('click', () => replay.toggle());

// Live gold: the price with its source and its age, always together.
const ticker = h('button', { type: 'button', class: 'ticker', hidden: true });
ticker.addEventListener('click', () => bar.run('XAU'));
const renderTicker = () => {
  const q = hub.liveGold;
  if (!state.settings.liveGold) {
    ticker.hidden = true;
    return;
  }
  ticker.hidden = false;
  if (!q) {
    ticker.className = 'ticker waiting';
    ticker.textContent = hub.liveGoldError ? 'Live gold unavailable' : 'Live gold…';
    ticker.title = hub.liveGoldError ? `gold-api.com could not be reached (${hub.liveGoldError}). Trying again every ${GOLD_POLL_SECONDS} seconds.` : 'Asking gold-api.com';
    return;
  }
  const age = Math.max(0, Date.now() / 1000 - q.time);
  const stale = age > GOLD_STALE_SECONDS;
  ticker.className = `ticker ${stale ? 'stale' : ''}`;
  ticker.replaceChildren(h('span', { class: 'ticker-dot', 'aria-hidden': 'true' }), h('span', { class: 'ticker-name' }, 'Gold'), h('span', { class: 'ticker-price' }, q.price.toFixed(2)), h('span', { class: 'ticker-age' }, `${stale ? 'stale, ' : ''}${formatAge(q.time)}`));
  ticker.title = `Spot gold in US dollars from ${q.source.label}, updated ${formatDateTime(q.time, state.settings.displayZone)} ${zoneLabel(state.settings.displayZone)}.${stale ? ' No newer price has arrived.' : ''} Click to chart gold.`;
};
hub.onLive(renderTicker);
state.onSettings(renderTicker);
setInterval(renderTicker, 1000); // keeps the age honest between quotes
let liveOn: boolean | null = null;
const syncLive = () => {
  if (state.settings.liveGold === liveOn) return;
  liveOn = state.settings.liveGold;
  hub.setLiveGold(liveOn);
};
state.onSettings(syncLive);

// ------------------------------------------------------ notices and hints

// Problems are said out loud, never left only in the console.
const toast = h('div', { class: 'toast', hidden: true, role: 'status' });
const showNotice = (text: string) => {
  const dismiss = h('button', { type: 'button', class: 'panel-tool', title: 'Dismiss', 'aria-label': 'Dismiss this message' }, icon('close', 14));
  dismiss.addEventListener('click', () => (toast.hidden = true));
  toast.replaceChildren(h('span', {}, text), dismiss);
  toast.hidden = false;
};
onProblem((message) => showNotice(`A panel hit a problem: ${message}`));
window.addEventListener('error', (ev) => showNotice(`Something went wrong: ${ev.message}`));
window.addEventListener('unhandledrejection', (ev) => showNotice(`Something went wrong: ${ev.reason instanceof Error ? ev.reason.message : String(ev.reason)}`));

// A first-visit note saying what the data is, with the way to bring in more.
const HINT_KEY = 'lmd.hint.sample.v1';
const hintSeen = () => {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
};
const hint = h('div', { class: 'hint', hidden: true });
const renderHint = () => {
  const wanted = hub.ready && state.workspace === 'overview' && hub.importedFiles().length === 0 && !hintSeen();
  hint.hidden = !wanted;
  if (!wanted || hint.childElementCount > 0) return;
  const open = h('button', { type: 'button', class: 'btn btn-primary' }, 'Import price files');
  open.addEventListener('click', () => state.setWorkspace('data'));
  const dismiss = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Got it');
  dismiss.addEventListener('click', () => {
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* it will simply show again */
    }
    hint.hidden = true;
  });
  hint.append(h('p', {}, h('strong', {}, 'You are looking at sample data. '), 'It has one value per day for gold and the 28 major pairs, which is enough for the weather map, the strength board and the gold views. Intraday charts need price files of your own.'), h('div', { class: 'hint-actions' }, open, dismiss));
};

// ---------------------------------------------------------------- layout

const desk = h('main', { class: 'desk' });
const syncPage = () => {
  const info = WORKSPACES[state.workspace];
  pageTitle.textContent = info.name;
  pageSummary.textContent = info.summary;
  document.title = `${info.name} · Liquid Markets Desk`;
  renderHint();
};
state.onLayout(syncPage);
state.onSettings(syncTimeframes);
hub.onChange(() => {
  syncTimeframes();
  renderHint();
});

document.getElementById('app')!.append(
  createSidebar(state),
  h(
    'div',
    { class: 'main' },
    h('header', { class: 'topbar' }, h('div', { class: 'page-heading' }, pageTitle, pageSummary), h('div', { class: 'topbar-controls' }, createInstrumentPicker(state, hub), timeframes, bar.el, replayButton, ticker)),
    replay.el,
    hint,
    desk,
  ),
  toast,
);

grid = new Grid(desk, ctx, factories);
syncPage();
syncTimeframes();
renderTicker();
syncLive();
void hub.start().then(() => {
  if (hub.startupErrors.length > 0) showNotice(`${hub.startupErrors.length === 1 ? hub.startupErrors[0] : `${hub.startupErrors.length} things could not be loaded`}. See the Data page.`);
});
