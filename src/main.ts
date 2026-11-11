/** Wires the shell together: state, data hub, panel grid and command bar. */
import './style.css';
import type { Command } from './app/commands';
import { openPanel } from './app/layout';
import type { PanelCode } from './app/panels';
import { AppState } from './app/state';
import { DataHub } from './data/hub';
import { chartPanel } from './panels/chart';
import { filesPanel } from './panels/files';
import { helpPanel } from './panels/help';
import { linksPanel } from './panels/links';
import { sessionPanel } from './panels/session';
import { strengthPanel } from './panels/strength';
import { volatilityPanel } from './panels/volatility';
import { placeholderPanel } from './panels/placeholder';
import type { PanelContext, PanelFactory } from './panels/types';
import { CommandBar } from './ui/commandBar';
import { Grid } from './ui/grid';
import { h } from './ui/dom';

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

const desk = h('main', { class: 'desk' });
document.getElementById('app')!.append(
  h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Liquid Markets Desk'), bar.el, selection),
  desk,
  h('footer', { class: 'statusbar' }, h('span', {}, 'For market context only. Not financial advice.'), h('span', { class: 'dim' }, 'Press / for commands · HELP lists everything')),
);

grid = new Grid(desk, ctx, factories);
void hub.start();
