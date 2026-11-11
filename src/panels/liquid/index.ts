/**
 * Liquid machine: a tank for each gold driver, piped into a gold tank.
 *
 *  pipe thickness  strength of the link (size of the correlation)
 *  pipe colour     direction: moving with gold, or against it
 *  liquid level    where the latest value sits in its recent range
 *
 * Drawing only: every number comes from driversView. The liquid is a
 * stylised 2D effect, not fluid physics. It pauses when hidden and becomes
 * a still picture under reduced motion.
 */
import { driversView, type DriverRow, type DriversView } from '../../app/analysis';
import type { LinkDirection } from '../../calc/drivers';
import { h } from '../../ui/dom';
import { animator, choiceBar, emptyState, live } from '../common';
import { describeMove } from '../drivers';
import type { PanelFactory } from '../types';
import { DIRECTION_COLORS, DIRECTION_WORDS, fillFraction, flowSpeed, pipeThickness } from './model';

const WINDOWS = [
  { value: 20, text: '20' },
  { value: 30, text: '30' },
  { value: 60, text: '60' },
] as const;

const C = {
  bg: '#080b10',
  glass: '#2c3847',
  glassLit: 'rgba(213, 220, 230, 0.16)',
  text: '#d5dce6',
  dim: '#7a8594',
  up: '#3fb27f',
  down: '#e0605a',
  gold: [217, 164, 65] as const,
  casing: '#05070a',
};
const rgba = (c: readonly [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(3)})`;
const signed = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const mono = (px: number, bold = false) => `${bold ? '600 ' : ''}${px}px ui-monospace, Menlo, Consolas, monospace`;

/** What is on screen for one driver; eased toward the data. */
interface Shown {
  fill: number;
  thickness: number; // as a fraction of height
  speed: number;
  color: [number, number, number];
}

const DRIVER_ORDER = ['dollar', 'yield', 'risk'] as const;
const SHORT_NAME: Record<(typeof DRIVER_ORDER)[number], string> = { dollar: 'US DOLLAR', yield: 'US 10Y YIELD', risk: 'RISK MOOD' };

export const liquidPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('weather-body');
  const windowBar = choiceBar<number>('Window in daily bars', WINDOWS, (bars) => state.update({ driverWindow: bars }));
  const canvas = h('canvas', { class: 'wx-layer', role: 'img', 'aria-label': 'Tanks for the dollar, the 10-year yield and risk mood, piped into a gold tank. The same readings are listed below.' });
  const host = h('div', { class: 'wx-host' }, canvas);
  const readout = h('div', { class: 'wx-readout' });
  const legend = h('p', { class: 'dim wx-legend' });
  const empty = h('div', { class: 'wx-empty', hidden: true });
  body.append(h('div', { class: 'panel-toolbar wx-toolbar' }, h('span', { class: 'dim' }, 'Window'), windowBar.el, h('span', { class: 'dim' }, 'daily bars')), host, empty, readout, legend);

  let view: DriversView | null = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let flow = 0; // running flow position, in pipe lengths
  const shown = new Map<string, Shown>();
  let goldFill = 0;

  const targetFor = (row: DriverRow): Shown => ({
    fill: fillFraction(row.level),
    thickness: pipeThickness(row.link?.r ?? null, 1),
    speed: row.available ? flowSpeed(row.link?.r ?? null) : 0,
    color: [...DIRECTION_COLORS[row.available ? row.direction : 'none']] as [number, number, number],
  });

  /** Glide the on-screen values toward the data. `k` of 1 jumps straight there. */
  const ease = (k: number) => {
    if (!view?.gold) return;
    goldFill += (fillFraction(view.gold.level) - goldFill) * k;
    for (const row of view.rows) {
      const t = targetFor(row);
      const s = shown.get(row.id);
      if (!s) {
        shown.set(row.id, t);
        continue;
      }
      s.fill += (t.fill - s.fill) * k;
      s.thickness += (t.thickness - s.thickness) * k;
      s.speed += (t.speed - s.speed) * k;
      for (let i = 0; i < 3; i++) s.color[i]! += (t.color[i]! - s.color[i]!) * k;
    }
  };

  const roundRect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + hgt, r);
    g.arcTo(x + w, y + hgt, x, y + hgt, r);
    g.arcTo(x, y + hgt, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  const drawTank = (g: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, fill: number, color: readonly [number, number, number], time: number, known: boolean) => {
    const r = Math.min(10, w * 0.08);
    g.save();
    roundRect(g, x, y, w, hgt, r);
    g.fillStyle = 'rgba(13, 17, 22, 0.9)';
    g.fill();
    if (known && fill > 0) {
      g.clip();
      const surface = y + hgt * (1 - fill);
      const amp = Math.min(3, hgt * 0.012);
      g.beginPath();
      g.moveTo(x, y + hgt);
      for (let i = 0; i <= 24; i++) {
        const px = x + (w * i) / 24;
        g.lineTo(px, surface + Math.sin(time * 1.6 + i * 0.7) * amp + Math.sin(time * 0.9 + i * 0.31) * amp * 0.6);
      }
      g.lineTo(x + w, y + hgt);
      g.closePath();
      const grad = g.createLinearGradient(0, surface, 0, y + hgt);
      grad.addColorStop(0, rgba(color, 0.85));
      grad.addColorStop(1, rgba(color, 0.35));
      g.fillStyle = grad;
      g.fill();
      // A bright line along the surface.
      g.strokeStyle = rgba(color, 1);
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const px = x + (w * i) / 24;
        const py = surface + Math.sin(time * 1.6 + i * 0.7) * amp + Math.sin(time * 0.9 + i * 0.31) * amp * 0.6;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
    // Glass.
    roundRect(g, x, y, w, hgt, r);
    g.strokeStyle = known ? C.glass : 'rgba(122, 133, 148, 0.5)';
    g.lineWidth = 1.5;
    if (!known) g.setLineDash([4, 4]);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = C.glassLit;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + w * 0.1, y + hgt * 0.08);
    g.lineTo(x + w * 0.1, y + hgt * 0.5);
    g.stroke();
    // Range marks: low, middle, high of the recent range.
    g.strokeStyle = 'rgba(122, 133, 148, 0.45)';
    for (const mark of [0.06, 0.5, 0.94]) {
      const my = y + hgt * (1 - mark);
      g.beginPath();
      g.moveTo(x + w - 6, my);
      g.lineTo(x + w, my);
      g.stroke();
    }
  };

  const draw = (time: number) => {
    const g = canvas.getContext('2d');
    if (!g || !view?.gold || width === 0) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, width, height);

    const small = Math.max(9, Math.min(12, height / 34));
    const pad = small * 2.2;
    const top = pad + small * 0.6;
    const usable = height - top - pad * 0.6;
    const tankW = Math.max(84, Math.min(width * 0.2, 230));
    const leftX = Math.max(small * 1.2, width * 0.06);
    const slot = usable / 3;
    const tankH = Math.max(14, slot - small * 3.4);
    const goldW = Math.max(100, Math.min(width * 0.24, 270));
    const goldX = width - Math.max(small * 1.2, width * 0.07) - goldW;
    const goldY = top + small * 1.4;
    const goldH = Math.max(40, usable - small * 3.8);

    // Pipes first, so the tanks sit on top of their ends.
    view.rows.forEach((row, i) => {
      const s = shown.get(row.id);
      if (!s) return;
      const y0 = top + slot * i + small * 1.4 + tankH / 2;
      const x0 = leftX + tankW;
      const y1 = goldY + goldH * (0.22 + 0.28 * i);
      const x1 = goldX;
      const bend = (x1 - x0) * 0.5;
      const path = new Path2D();
      path.moveTo(x0, y0);
      path.bezierCurveTo(x0 + bend, y0, x1 - bend, y1, x1, y1);
      const thick = Math.max(1.5, s.thickness * Math.min(height, width * 0.6));
      const known = row.available && row.link?.r !== null && row.link?.r !== undefined;
      g.lineCap = 'butt';
      g.strokeStyle = C.casing;
      g.lineWidth = thick + 5;
      g.stroke(path);
      g.strokeStyle = C.glass;
      g.lineWidth = thick + 3;
      g.stroke(path);
      g.strokeStyle = C.bg;
      g.lineWidth = thick + 0.5;
      g.stroke(path);
      if (known) {
        g.strokeStyle = rgba(s.color, 0.5);
        g.lineWidth = thick;
        g.stroke(path);
        // Flow marks travelling toward the gold tank.
        const length = Math.hypot(x1 - x0, y1 - y0) * 1.08;
        const dash = Math.max(6, length * 0.035);
        g.setLineDash([dash, dash * 1.6]);
        g.lineDashOffset = -flow * s.speed * length;
        g.strokeStyle = rgba(s.color, 0.95);
        g.lineWidth = Math.max(1, thick * 0.55);
        g.stroke(path);
        g.setLineDash([]);
        g.lineDashOffset = 0;
      } else {
        g.setLineDash([3, 5]);
        g.strokeStyle = 'rgba(122, 133, 148, 0.5)';
        g.lineWidth = 1;
        g.stroke(path);
        g.setLineDash([]);
      }
      // The link, written on the pipe.
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const text = known ? `${signed(row.link!.r!, 2)} ${DIRECTION_WORDS[row.direction]}` : row.available ? `needs ${view!.window} days` : 'no data';
      g.font = mono(small, true);
      const tw = g.measureText(text).width;
      g.fillStyle = 'rgba(7, 9, 12, 0.82)';
      g.fillRect(mx - tw / 2 - 5, my - thick / 2 - small * 1.7, tw + 10, small * 1.45);
      g.fillStyle = known ? rgba(s.color, 1) : C.dim;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, mx, my - thick / 2 - small * 0.95);
    });

    // Driver tanks.
    view.rows.forEach((row, i) => {
      const s = shown.get(row.id);
      if (!s) return;
      const x = leftX;
      const y = top + slot * i + small * 1.4;
      drawTank(g, x, y, tankW, tankH, s.fill, s.color, time, row.available);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.font = mono(small * 0.92);
      g.fillStyle = C.dim;
      g.fillText(SHORT_NAME[row.id as (typeof DRIVER_ORDER)[number]] ?? row.label.toUpperCase(), x, y - small * 0.45);
      g.font = mono(small, true);
      if (row.available) {
        const move = describeMove(row);
        g.fillStyle = C.text;
        g.fillText(move.value, x, y + tankH + small * 1.25);
        g.fillStyle = move.up === null ? C.dim : move.up ? C.up : C.down;
        g.fillText(` ${move.up === null ? '•' : move.up ? '▲' : '▼'} ${move.change}`, x + g.measureText(move.value).width, y + tankH + small * 1.25);
      } else {
        g.fillStyle = C.dim;
        g.fillText('no data', x, y + tankH + small * 1.25);
      }
    });

    // The gold tank.
    drawTank(g, goldX, goldY, goldW, goldH, goldFill, C.gold, time, true);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = mono(small * 0.92);
    g.fillStyle = rgba(C.gold, 1);
    g.fillText('GOLD · XAU/USD', goldX, goldY - small * 0.45);
    const gm = view.gold.latest;
    if (gm) {
      g.font = mono(small * 1.15, true);
      g.fillStyle = C.text;
      const price = gm.value.toFixed(2);
      g.fillText(price, goldX, goldY + goldH + small * 1.4);
      g.fillStyle = gm.change > 0 ? C.up : gm.change < 0 ? C.down : C.dim;
      g.fillText(` ${gm.change > 0 ? '▲' : gm.change < 0 ? '▼' : '•'} ${signed(gm.change, 2)}%`, goldX + g.measureText(price).width, goldY + goldH + small * 1.4);
    }
  };

  const anim = animator(host, {
    ready: () => view?.gold != null && width > 0,
    frame: (now, dt) => {
      ease(Math.min(1, dt * 4));
      flow += dt;
      draw(now / 1000);
    },
    still: () => {
      ease(1);
      draw(0);
    },
  });

  const resize = () => {
    const rect = host.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    width = rect.width;
    height = rect.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (!anim.isRunning()) {
      ease(1);
      draw(0);
    }
  };
  const resizeObserver = new ResizeObserver(() => {
    resize();
    anim.sync();
  });
  resizeObserver.observe(host);

  const chip = (row: DriverRow): HTMLElement => {
    const r = row.link?.r ?? null;
    const direction: LinkDirection = row.available ? row.direction : 'none';
    const el = h(
      'span',
      { class: `wx-chip liq-chip dir-${direction}`, 'data-driver': row.id, 'data-direction': direction, 'data-r': r === null ? '' : r.toFixed(4), 'data-thickness': pipeThickness(r, 1000).toFixed(2) },
      h('span', { class: 'wx-ccy' }, row.label),
    );
    if (!row.available) el.append(h('span', { class: 'dim' }, 'no data'));
    else if (r === null) el.append(h('span', { class: 'dim' }, `needs ${view!.window} days, has ${row.link!.n}`));
    else {
      el.append(
        h('span', { class: 'liq-r', title: 'Link with gold: correlation over the window' }, `${signed(r, 2)} ${DIRECTION_WORDS[direction]}`),
        h('span', { class: 'dim', title: 'Where the latest value sits in its range over the window' }, row.level === null ? '' : `level ${(row.level * 100).toFixed(0)}%`),
      );
    }
    return el;
  };

  return live(
    ctx,
    async (current) => {
      const { driverWindow } = state.settings;
      windowBar.set(driverWindow);
      const next = await driversView(hub, driverWindow);
      if (!current()) return;
      if (!next.gold) {
        view = null;
        host.hidden = true;
        empty.hidden = false;
        empty.replaceChildren(emptyState('The liquid machine cannot be drawn.', next.reason ?? '', { label: 'Open Files', run: () => ctx.run('FILES') }));
        readout.replaceChildren();
        legend.textContent = '';
        footer.textContent = 'No data loaded for this view.';
        anim.sync();
        return;
      }
      const first = view === null;
      view = next;
      host.hidden = false;
      empty.hidden = true;
      if (width === 0) resize();
      if (first) {
        shown.clear();
        goldFill = fillFraction(next.gold.level);
        ease(1);
      }
      const goldChip = h('span', { class: 'wx-chip', 'data-driver': 'gold' }, h('span', { class: 'wx-ccy gold' }, 'Gold'), h('span', { class: 'dim' }, next.gold.level === null ? '' : `level ${(next.gold.level * 100).toFixed(0)}%`));
      readout.replaceChildren(goldChip, ...next.rows.map(chip));
      legend.textContent = `A thicker pipe is a stronger link with gold over the last ${driverWindow} days. Blue means the driver has moved with gold, violet against it. Each tank's level is where its latest value sits between its ${driverWindow}-day low and high.${next.gold.closeOnly ? ' Gold here is a daily reference rate that trails the market by about a day, so links are understated.' : ''}`;
      const lastDay = Math.max(...next.rows.map((r) => r.link?.lastTime ?? 0), next.gold.latest?.time ?? 0);
      footer.textContent = ['D1', `${driverWindow}-day window`, lastDay > 0 ? `to ${new Date(lastDay * 1000).toISOString().slice(0, 10)}` : '', next.replay ? 'replay' : '', `gold: ${next.gold.sourceLabel}`].filter(Boolean).join(' · ');
      anim.sync();
      if (!anim.isRunning()) {
        ease(1);
        draw(0);
      }
    },
    () => {
      anim.stop();
      resizeObserver.disconnect();
    },
  );
};
