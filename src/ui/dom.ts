/** Small DOM helpers. Text always goes in as text, never as HTML. */

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') el.className = String(value);
    else el.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export type Zone = 'local' | 'utc';

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-09 13:00" in the chosen zone. */
export function formatDateTime(seconds: number, zone: Zone): string {
  const d = new Date(seconds * 1000);
  return zone === 'utc'
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A daily bar's stamp is a calendar date, so it is never shifted by zone. */
export function formatDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function zoneLabel(zone: Zone): string {
  if (zone === 'utc') return 'UTC';
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? ':' + pad(abs % 60) : ''}`;
}

/** How old a data point is, in plain words. */
export function formatAge(asOf: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(now - asOf));
  if (s < 90) return `${s} s old`;
  if (s < 5400) return `${Math.round(s / 60)} min old`;
  if (s < 172800) return `${Math.round(s / 3600)} h old`;
  return `${Math.round(s / 86400)} days old`;
}
