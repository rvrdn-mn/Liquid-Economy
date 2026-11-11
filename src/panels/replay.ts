/** Replay: rewind every panel to a past moment, then step or play forward. */
import { snapToStep } from '../app/replay';
import { widestBar } from '../calc/volatility';
import { TIMEFRAME_SECONDS } from '../data/types';
import { formatDate, formatDateTime, h, zoneLabel, type Zone } from '../ui/dom';
import { choiceBar, live } from './common';
import type { PanelFactory } from './types';

const SPEEDS = [
  { value: 1, text: '1' },
  { value: 2, text: '2' },
  { value: 5, text: '5' },
  { value: 10, text: '10' },
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** Value for a datetime-local input, in the display zone. */
function toInputValue(seconds: number, zone: Zone): string {
  const d = new Date(seconds * 1000);
  return zone === 'utc'
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputValue(value: string, zone: Zone): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const ms = Date.parse(zone === 'utc' ? `${value}Z` : value);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

export const replayPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  const step = () => TIMEFRAME_SECONDS[state.settings.timeframe];

  const status = h('p', { class: 'replay-status', 'aria-live': 'polite' });
  const when = h('input', { type: 'datetime-local', 'aria-label': 'Replay date and time' });
  const go = h('button', { type: 'button', class: 'button' }, 'Go');
  const back = h('button', { type: 'button', class: 'button', title: 'One step back' }, '◀ Step');
  const play = h('button', { type: 'button', class: 'button primary' }, '▶ Play');
  const forward = h('button', { type: 'button', class: 'button', title: 'One step forward' }, 'Step ▶');
  const latest = h('button', { type: 'button', class: 'button' }, 'Back to latest');
  const slider = h('input', { type: 'range', class: 'replay-slider', 'aria-label': 'Replay position' });
  const speed = choiceBar<number>('Steps per second', SPEEDS, (v) => hub.setReplaySpeed(v, step));
  const stepNote = h('span', { class: 'dim' });
  const busiest = h('button', { type: 'button', class: 'button' });
  const range = h('p', { class: 'dim' });

  body.append(
    status,
    h('div', { class: 'panel-toolbar' }, when, go),
    h('div', { class: 'panel-toolbar' }, back, play, forward, latest),
    slider,
    h('div', { class: 'panel-toolbar' }, h('span', { class: 'dim' }, 'Steps per second'), speed.el, stepNote),
    h('div', { class: 'panel-toolbar' }, busiest),
    range,
    h('p', { class: 'dim note' }, 'While replaying, every panel shows only what was known at the replay moment. Bars built from finer files grow step by step; other data appears once its bar has finished.'),
  );

  /** Start replaying from a moment, rounded down to a whole step. */
  const goTo = (time: number) => hub.setReplayTime(snapToStep(time, Math.min(step(), 3600)));

  go.addEventListener('click', () => {
    const t = fromInputValue(when.value, state.settings.displayZone);
    if (t !== null) goTo(t);
  });
  when.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') go.click();
  });
  slider.addEventListener('input', () => goTo(Number(slider.value)));
  const ensureStarted = () => {
    if (hub.replayTime !== null) return true;
    const extent = hub.extent();
    if (!extent) return false;
    // Starting from "latest" has nowhere to go, so begin a little before the end.
    goTo(extent.last - 50 * step());
    return hub.replayTime !== null;
  };
  back.addEventListener('click', () => {
    if (ensureStarted()) hub.stepReplay(step(), -1);
  });
  forward.addEventListener('click', () => {
    if (ensureStarted()) hub.stepReplay(step(), 1);
  });
  play.addEventListener('click', () => {
    if (hub.replayPlaying) hub.pauseReplay();
    else if (ensureStarted()) hub.playReplay(step);
  });
  latest.addEventListener('click', () => hub.setReplayTime(null));

  let busiestTime: number | null = null;
  busiest.addEventListener('click', () => {
    if (busiestTime !== null) goTo(busiestTime);
  });

  return live(ctx, async (current) => {
    const { displayZone: zone, timeframe, instrument } = state.settings;
    const extent = hub.extent();
    const t = hub.replayTime;
    const fmt = (s: number) => `${formatDateTime(s, zone)} ${zoneLabel(zone)}`;

    status.replaceChildren(
      t === null
        ? h('span', {}, 'Showing the latest loaded data. Pick a moment to replay from.')
        : h('span', {}, h('span', { class: 'replay-tag' }, hub.replayPlaying ? 'PLAYING' : 'REPLAY'), ` ${fmt(t)}`),
    );
    play.textContent = hub.replayPlaying ? '❚❚ Pause' : '▶ Play';
    latest.disabled = t === null;
    speed.set(hub.replaySpeed);
    stepNote.textContent = `each step is one ${timeframe} bar`;
    for (const el of [when, go, back, play, forward, slider]) el.disabled = !extent;

    if (extent) {
      slider.min = String(extent.first);
      slider.max = String(extent.last);
      slider.step = String(step());
      slider.value = String(t ?? extent.last);
      if (document.activeElement !== when) when.value = toInputValue(t ?? extent.last, zone);
      when.min = toInputValue(extent.first, zone);
      when.max = toInputValue(extent.last, zone);
      range.textContent = `Loaded data runs from ${fmt(extent.first)} to ${fmt(extent.last)}.`;
    } else {
      range.textContent = 'No data is loaded, so there is nothing to replay.';
    }
    footer.textContent = t === null ? 'Not replaying' : `Replaying · ${hub.replayPlaying ? `${hub.replaySpeed} steps a second` : 'paused'}`;

    // The widest daily bar of the selected instrument, as a quick place to jump to.
    // Asked for without the replay cut, so the choice does not move as replay runs.
    const daily = await hub.getBars({ instrument, timeframe: 'D1', asOf: Number.MAX_SAFE_INTEGER });
    if (!current()) return;
    const widest = daily && !daily.source.closeOnly ? widestBar(daily.bars) : null;
    if (widest) {
      busiestTime = widest.bar.time;
      busiest.textContent = `Jump to ${instrument}'s widest day: ${formatDate(widest.bar.time)} (${widest.rangePercent.toFixed(2)}% range)`;
      busiest.hidden = false;
    } else {
      busiestTime = null;
      busiest.hidden = true;
    }
  });
};
