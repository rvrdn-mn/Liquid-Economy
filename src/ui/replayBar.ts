/** Replay bar: one row under the header to rewind every panel, then step or play. */
import { snapToStep } from '../app/replay';
import type { AppState } from '../app/state';
import { widestBar } from '../calc/volatility';
import type { DataHub } from '../data/hub';
import { TIMEFRAME_SECONDS } from '../data/types';
import { formatDate, formatDateTime, h, zoneLabel, type Zone } from './dom';

const pad = (n: number) => String(n).padStart(2, '0');

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

export interface ReplayBar {
  el: HTMLElement;
  /** Show or hide the bar. Hiding it also leaves replay. */
  toggle(): void;
  isOpen(): boolean;
}

export function createReplayBar(state: AppState, hub: DataHub, onOpenChange: () => void): ReplayBar {
  const step = () => TIMEFRAME_SECONDS[state.settings.timeframe];
  let open = false;

  const status = h('span', { class: 'replay-status', 'aria-live': 'polite' });
  const when = h('input', { type: 'datetime-local', class: 'replay-when', 'aria-label': 'Replay date and time' });
  const back = h('button', { type: 'button', class: 'btn', title: 'One bar back' }, '◀');
  const play = h('button', { type: 'button', class: 'btn btn-primary replay-play' }, 'Play');
  const forward = h('button', { type: 'button', class: 'btn', title: 'One bar forward' }, '▶');
  const slider = h('input', { type: 'range', class: 'replay-slider', 'aria-label': 'Replay position' });
  const speed = h('select', { class: 'replay-speed', 'aria-label': 'Bars per second' }, ...[1, 2, 5, 10].map((v) => h('option', { value: String(v) }, `${v} bar${v === 1 ? '' : 's'}/s`)));
  const widest = h('button', { type: 'button', class: 'btn btn-quiet', hidden: true });
  const exit = h('button', { type: 'button', class: 'btn' }, 'Exit replay');
  const el = h('div', { class: 'replay-bar', hidden: true, role: 'region', 'aria-label': 'Replay' }, status, when, back, play, forward, slider, speed, widest, exit);

  const goTo = (time: number) => hub.setReplayTime(snapToStep(time, Math.min(step(), 3600)));
  /**
   * Replay needs a starting point. It begins sixty bars before the end of
   * what the chart is showing, so there is something to play through; if
   * the chart has nothing, sixty bars before the end of all loaded data.
   */
  const ensureStarted = async (): Promise<boolean> => {
    if (hub.replayTime !== null) return true;
    const extent = hub.extent();
    if (!extent) return false;
    const { instrument, timeframe } = state.settings;
    const shown = await hub.getBars({ instrument, timeframe });
    const end = shown ? shown.bars[shown.bars.length - 1]!.time + step() : extent.last;
    goTo(end - 60 * step());
    return hub.replayTime !== null;
  };

  when.addEventListener('change', () => {
    const t = fromInputValue(when.value, state.settings.displayZone);
    if (t !== null) goTo(t);
  });
  slider.addEventListener('input', () => goTo(Number(slider.value)));
  back.addEventListener('click', async () => {
    if (await ensureStarted()) hub.stepReplay(step(), -1);
  });
  forward.addEventListener('click', async () => {
    if (await ensureStarted()) hub.stepReplay(step(), 1);
  });
  play.addEventListener('click', async () => {
    if (hub.replayPlaying) hub.pauseReplay();
    else if (await ensureStarted()) hub.playReplay(step);
  });
  speed.addEventListener('change', () => hub.setReplaySpeed(Number(speed.value), step));
  let widestTime: number | null = null;
  widest.addEventListener('click', () => widestTime !== null && goTo(widestTime));
  const setOpen = (next: boolean) => {
    open = next;
    el.hidden = !open;
    if (!open) hub.setReplayTime(null);
    else void ensureStarted();
    onOpenChange();
  };
  exit.addEventListener('click', () => setOpen(false));

  let ticket = 0;
  const sync = async () => {
    const zone = state.settings.displayZone;
    const t = hub.replayTime;
    // Replay switched on from elsewhere (a command) opens the bar; it never stays hidden while active.
    if (t !== null && !open) {
      open = true;
      el.hidden = false;
      onOpenChange();
    }
    const extent = hub.extent();
    status.replaceChildren(
      t === null ? h('span', { class: 'muted' }, 'Replay is off') : h('span', {}, h('span', { class: 'tag tag-gold' }, hub.replayPlaying ? 'PLAYING' : 'REPLAY'), ` ${formatDateTime(t, zone)} ${zoneLabel(zone)}`),
    );
    play.textContent = hub.replayPlaying ? 'Pause' : 'Play';
    speed.value = String(hub.replaySpeed);
    for (const c of [when, back, play, forward, slider]) c.disabled = !extent;
    if (extent) {
      slider.min = String(extent.first);
      slider.max = String(extent.last);
      slider.step = String(step());
      slider.value = String(t ?? extent.last);
      if (document.activeElement !== when) when.value = toInputValue(t ?? extent.last, zone);
      when.min = toInputValue(extent.first, zone);
      when.max = toInputValue(extent.last, zone);
    }
    if (!open) return;
    const mine = ++ticket;
    const daily = await hub.getBars({ instrument: state.settings.instrument, timeframe: 'D1', asOf: Number.MAX_SAFE_INTEGER });
    if (mine !== ticket) return;
    const found = daily && !daily.source.closeOnly ? widestBar(daily.bars) : null;
    widestTime = found ? found.bar.time : null;
    widest.hidden = !found;
    if (found) {
      widest.textContent = `Widest day: ${formatDate(found.bar.time)}`;
      widest.title = `Jump to ${state.settings.instrument}'s widest day in the loaded data (${found.rangePercent.toFixed(2)}% range)`;
    }
  };
  hub.onChange(() => void sync());
  state.onSettings(() => void sync());
  void sync();

  return { el, toggle: () => setOpen(!open), isOpen: () => open };
}
