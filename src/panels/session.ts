/**
 * Session clock: Asia, London and New York on a 24-hour dial in display
 * time, with the selected instrument's average range for each hour.
 * Drawing only.
 */
import { sessionView } from '../app/analysis';
import { sessionHoursUtc, sessionsOpenAt } from '../calc/session';
import { formatAge, h, zoneLabel } from '../ui/dom';
import { live, svg } from './common';
import type { PanelFactory } from './types';

const SIZE = 330;
const C = SIZE / 2;

/** Point on the dial. Hour 0 is at the top; hours run clockwise. */
function at(hour: number, radius: number): [number, number] {
  const a = (hour / 24) * 2 * Math.PI - Math.PI / 2;
  return [C + radius * Math.cos(a), C + radius * Math.sin(a)];
}

/** A ring segment between two hours (may pass midnight) and two radii. */
function segment(from: number, to: number, inner: number, outer: number): string {
  const span = (((to - from) % 24) + 24) % 24 || 24;
  const end = from + span;
  const large = span > 12 ? 1 : 0;
  const [x1, y1] = at(from, outer);
  const [x2, y2] = at(end, outer);
  const [x3, y3] = at(end, inner);
  const [x4, y4] = at(from, inner);
  const f = (n: number) => n.toFixed(2);
  return `M${f(x1)} ${f(y1)} A${outer} ${outer} 0 ${large} 1 ${f(x2)} ${f(y2)} L${f(x3)} ${f(y3)} A${inner} ${inner} 0 ${large} 0 ${f(x4)} ${f(y4)} Z`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (hour: number) => {
  const total = Math.round((((hour % 24) + 24) % 24) * 60) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

export const sessionPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('scroll');
  const dialHost = h('div', { class: 'dial-host' });
  const info = h('div', { class: 'dial-info' });
  body.append(h('div', { class: 'session-layout' }, dialHost, info));

  let lastProfile: Awaited<ReturnType<typeof sessionView>> | null = null;

  const draw = () => {
    const view = lastProfile;
    if (!view) return;
    const now = hub.now();
    const zone = state.settings.displayZone;
    // Hours to add to a UTC hour to place it on the dial.
    const shift = zone === 'utc' ? 0 : -new Date().getTimezoneOffset() / 60;
    const root = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'dial', role: 'img', 'aria-label': 'Trading sessions on a 24-hour dial' });

    // Outer ring: average hourly range of the selected instrument.
    const profile = view.profile;
    const peak = profile ? Math.max(0, ...profile.averageRangePercent.map((v) => v ?? 0)) : 0;
    for (let hr = 0; hr < 24; hr++) {
      const value = profile?.averageRangePercent[hr] ?? null;
      const path = svg('path', { d: segment(hr + shift, hr + 1 + shift, 116, 138), class: value === null ? 'heat none' : 'heat' });
      if (value !== null && peak > 0) path.style.fillOpacity = String(0.08 + 0.82 * (value / peak));
      const label = `${clock(hr + shift)} to ${clock(hr + 1 + shift)}: ${value === null ? 'no data' : `average range ${value.toFixed(3)}%`}`;
      path.append(svg('title', {}, label));
      root.append(path);
    }

    // Session arcs, one ring each.
    const open = new Set(sessionsOpenAt(now));
    const hours = sessionHoursUtc(now);
    hours.forEach((s, i) => {
      const outer = 108 - i * 18;
      const arc = svg('path', { d: segment(s.openUtc + shift, s.closeUtc + shift, outer - 12, outer), class: `session-arc ${open.has(s.name) ? 'open' : ''}` });
      arc.append(svg('title', {}, `${s.name} (${s.city}): ${clock(s.openUtc + shift)} to ${clock(s.closeUtc + shift)}`));
      root.append(arc);
      const mid = s.openUtc + shift + ((((s.closeUtc - s.openUtc) % 24) + 24) % 24) / 2;
      const [lx, ly] = at(mid, outer - 6);
      root.append(svg('text', { x: lx.toFixed(1), y: (ly + 3).toFixed(1), class: 'session-label' }, s.name));
    });

    // Hour ticks and labels in display time.
    for (let hr = 0; hr < 24; hr++) {
      const [x1, y1] = at(hr, 139);
      const [x2, y2] = at(hr, hr % 3 === 0 ? 145 : 142);
      root.append(svg('line', { x1, y1, x2, y2, class: 'tick' }));
      if (hr % 3 === 0) {
        const [px, py] = at(hr, 155);
        root.append(svg('text', { x: px.toFixed(1), y: (py + 3).toFixed(1), class: 'hour-label' }, pad(hr)));
      }
    }

    // The hand: now, in display time.
    const d = new Date(now * 1000);
    const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const [hx, hy] = at(utcHour + shift, 145);
    const [bx, by] = at(utcHour + shift, 40);
    root.append(svg('line', { x1: bx, y1: by, x2: hx, y2: hy, class: 'hand' }));
    root.append(svg('text', { x: C, y: C - 2, class: 'dial-time' }, clock(utcHour + shift)));
    root.append(svg('text', { x: C, y: C + 13, class: 'dial-zone' }, zoneLabel(zone)));
    dialHost.replaceChildren(root);

    // Text beside the dial.
    const nodes: Node[] = [];
    const when = hub.replayTime === null ? 'now' : 'at the replay moment';
    nodes.push(h('p', {}, open.size > 0 ? `Open ${when}: ${[...open].join(', ')}.` : `No session is open ${when}.`));
    const list = h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Session'), h('th', {}, `Hours (${zoneLabel(zone)})`))));
    const tb = h('tbody', {});
    for (const s of hours) tb.append(h('tr', { class: open.has(s.name) ? 'open-row' : '' }, h('td', {}, `${s.name} · ${s.city}`), h('td', {}, `${clock(s.openUtc + shift)} to ${clock(s.closeUtc + shift)}`)));
    list.append(tb);
    nodes.push(list);

    nodes.push(h('h3', {}, `${view.instrument} average hourly range`));
    if (!profile) {
      nodes.push(h('p', { class: 'dim' }, view.reason ?? 'No data.'));
      const b = h('button', { type: 'button', class: 'button' }, 'Import files');
      b.addEventListener('click', () => ctx.run('FILES'));
      nodes.push(b);
      footer.textContent = 'Session hours are clock facts. No price data shown.';
    } else {
      const ranked = profile.averageRangePercent
        .map((v, hr) => ({ v, hr }))
        .filter((x): x is { v: number; hr: number } => x.v !== null)
        .sort((a, b) => b.v - a.v);
      const top = ranked.slice(0, 3);
      const quiet = ranked.slice(-3).reverse();
      nodes.push(h('p', {}, 'Busiest hours: ', h('span', { class: 'mono' }, top.map((x) => `${clock(x.hr + shift)} (${x.v.toFixed(3)}%)`).join(', ')), '.'));
      nodes.push(h('p', {}, 'Quietest hours: ', h('span', { class: 'mono' }, quiet.map((x) => `${clock(x.hr + shift)} (${x.v.toFixed(3)}%)`).join(', ')), '.'));
      nodes.push(h('p', { class: 'dim note' }, `Outer ring: brighter means a wider average high-to-low range in that hour, over the last ${state.settings.sessionProfileDays} days of data (${profile.daysCovered} covered). Hover a segment for its value.`));
      footer.textContent = [view.sourceLabel ?? '', 'hourly ranges', hub.replayTime !== null ? 'replay' : view.asOf !== undefined ? formatAge(view.asOf) : ''].filter(Boolean).join(' · ');
    }
    info.replaceChildren(...nodes);
  };

  // Keep the hand moving, but not while the tab is hidden.
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') draw();
  }, 30_000);

  return live(
    ctx,
    async (current) => {
      const view = await sessionView(hub, state.settings.instrument, state.settings.sessionProfileDays);
      if (!current()) return;
      lastProfile = view;
      draw();
    },
    () => clearInterval(timer),
  );
};
