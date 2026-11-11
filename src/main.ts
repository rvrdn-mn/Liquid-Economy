/** Wires the shell together: state, data hub, panel grid and command bar. */
import './style.css';
import type { Command } from './app/commands';
import { openPanel } from './app/layout';
import type { PanelCode } from './app/panels';
import { AppState } from './app/state';
import { DataHub } from './data/hub';
import { chartPanel } from './panels/chart';
import { driversPanel } from './panels/drivers';
import { filesPanel } from './panels/files';
import { helpPanel } from './panels/help';
import { journalPanel } from './panels/journal';
import { linksPanel } from './panels/links';
import { liquidPanel } from './panels/liquid';
import { sessionPanel } from './panels/session';
import { strengthPanel } from './panels/strength';
import { volatilityPanel } from './panels/volatility';
import { weatherPanel } from './panels/weather';
import { placeholderPanel } from './panels/placeholder';
import { replayPanel } from './panels/replay';
import type { PanelContext, PanelFactory } from './panels/types';
import { CommandBar } from './ui/commandBar';
import { Grid } from './ui/grid';
import { GOLD_POLL_SECONDS, GOLD_STALE_SECONDS } from './data/goldApi';
import { formatAge, formatDateTime, h, zoneLabel } from './ui/dom';

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
  RPL: replayPanel,
  WX: weatherPanel,
  DRV: driversPanel,
  LIQ: liquidPanel,
  JRN: journalPanel,
};
const factories = (code: PanelCode): PanelFactory => built[code] ?? placeholderPanel(code);

let grid: Grid | null = null;

function show(code: PanelCode): void {
  const { layout, id } = openPanel(state.layout, code);
  state.setLayout(layout);
  grid?.flash(id);
}

function execute(commands: Command[]): void {
  for (const c of commands) {
    if (c.kind === 'instrument') {
      state.update({ instrument: c.instrument });
      show('CHART');
    } else if (c.kind === 'timeframe') {
      state.update({ timeframe: c.timeframe });
      show('CHART');
    } else if (c.kind === 'panel') {
      show(c.code);
    }
  }
}

const bar = new CommandBar({ execute });
const ctx: PanelContext = { state, hub, run: (text) => bar.run(text) };

const selection = h('span', { class: 'selection' });
const renderSelection = () => {
  selection.textContent = `${state.settings.instrument} · ${state.settings.timeframe}`;
};
state.onSettings(renderSelection);
renderSelection();

// Replay must be impossible to mistake for current data: a marker in the top bar.
const replayMark = h('button', { type: 'button', class: 'replay-mark', hidden: true, title: 'Replaying past data. Click to open the replay panel.' });
replayMark.addEventListener('click', () => bar.run('RPL'));
const renderReplayMark = () => {
  const t = hub.replayTime;
  replayMark.hidden = t === null;
  if (t !== null) replayMark.textContent = `REPLAY ${formatDateTime(t, state.settings.displayZone)} ${zoneLabel(state.settings.displayZone)}`;
};
hub.onChange(renderReplayMark);
state.onSettings(renderReplayMark);

// Live gold: the price with its source and its age, always together.
const ticker = h('button', { type: 'button', class: 'ticker', hidden: true });
ticker.addEventListener('click', () => bar.run('XAU CHART'));
const renderTicker = () => {
  const q = hub.liveGold;
  if (!state.settings.liveGold) {
    ticker.hidden = true;
    return;
  }
  ticker.hidden = false;
  if (!q) {
    ticker.className = 'ticker waiting';
    ticker.textContent = hub.liveGoldError ? 'Live gold unavailable' : 'Live gold: waiting';
    ticker.title = hub.liveGoldError ? `gold-api.com could not be reached (${hub.liveGoldError}). Trying again every ${GOLD_POLL_SECONDS} seconds.` : 'Asking gold-api.com';
    return;
  }
  const age = Math.max(0, Date.now() / 1000 - q.time);
  const stale = age > GOLD_STALE_SECONDS;
  ticker.className = `ticker ${stale ? 'stale' : ''}`;
  ticker.replaceChildren(
    h('span', { class: 'ticker-name' }, 'XAU'),
    h('span', { class: 'ticker-price' }, q.price.toFixed(2)),
    h('span', { class: 'ticker-age' }, `${stale ? 'stale · ' : ''}${formatAge(q.time)} · ${q.source.label}`),
  );
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

const desk = h('main', { class: 'desk' });
document.getElementById('app')!.append(
  h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Liquid Markets Desk'), bar.el, replayMark, ticker, selection),
  desk,
  h('footer', { class: 'statusbar' }, h('span', {}, 'For market context only. Not financial advice.'), h('span', { class: 'dim' }, 'Press / for commands · HELP lists everything')),
);

grid = new Grid(desk, ctx, factories);
renderTicker();
syncLive();
void hub.start();
