/** Shared pieces for the analysis panels: live refresh and footers. */
import type { Loaded } from '../app/analysis';
import { formatAge, formatDate, formatDateTime, h, zoneLabel, type Zone } from '../ui/dom';
import type { PanelContext, PanelInstance } from './types';

/**
 * Re-run `refresh` whenever settings or data change. Each run gets a
 * `current()` check so a slow run that was overtaken can stop quietly.
 */
export function live(ctx: PanelContext, refresh: (current: () => boolean) => Promise<void> | void, extraCleanup?: () => void): PanelInstance {
  let ticket = 0;
  const run = () => {
    const mine = ++ticket;
    void refresh(() => mine === ticket);
  };
  const offSettings = ctx.state.onSettings(run);
  const offData = ctx.hub.onChange(run);
  run();
  return {
    destroy() {
      ticket = -1;
      offSettings();
      offData();
      extraCleanup?.();
    },
  };
}

/** "9 Nov 2026" style moment a comparison is valid for. */
export function asOfText(loaded: Loaded, zone: Zone): string {
  if (loaded.asOf === null) return 'no data';
  // A daily bar's end is the midnight after it, so name the bar's own date.
  return loaded.barSeconds >= 86400 ? formatDate(loaded.asOf - loaded.barSeconds) : `${formatDateTime(loaded.asOf, zone)} ${zoneLabel(zone)}`;
}

/** Footer text: timeframe, moment, age, coverage and where the data came from. */
export function loadedFooter(loaded: Loaded, zone: Zone, total: number): string {
  if (loaded.asOf === null) return 'No data loaded for this view.';
  const parts = [loaded.timeframe, `as of ${asOfText(loaded, zone)}`, formatAge(loaded.asOf), `${loaded.series.size}/${total} instruments`, loaded.sources.join(' + ')];
  if (loaded.limitedBy) parts.push(`held back by ${loaded.limitedBy}, whose data ends first`);
  return parts.join(' · ');
}

export function emptyState(title: string, detail: string, action?: { label: string; run: () => void }): HTMLElement {
  const box = h('div', { class: 'panel-empty' }, h('p', { class: 'empty-title' }, title), h('p', { class: 'dim' }, detail));
  if (action) {
    const b = h('button', { type: 'button', class: 'button' }, action.label);
    b.addEventListener('click', action.run);
    box.append(b);
  }
  return box;
}

/** A row of mutually exclusive choices, e.g. lookbacks. */
export function choiceBar<T extends number | string>(label: string, choices: readonly { value: T; text: string }[], onPick: (value: T) => void) {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h('div', { class: 'tf-bar', role: 'group', 'aria-label': label });
  for (const c of choices) {
    const b = h('button', { type: 'button', class: 'tf' }, c.text);
    b.addEventListener('click', () => onPick(c.value));
    buttons.set(c.value, b);
    el.append(b);
  }
  return {
    el,
    set(value: T) {
      for (const [v, b] of buttons) {
        b.classList.toggle('active', v === value);
        b.setAttribute('aria-pressed', String(v === value));
      }
    },
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}
