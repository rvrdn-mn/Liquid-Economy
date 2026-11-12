/**
 * Liquid Economy lab: a what-if teaching model, kept apart from the live
 * analysis panels. It reads no market data and no other panel reads it.
 *
 * Drawing only. The model is src/calc/lab.ts.
 */
import { createLab, LAB, runLab, setPolicy, stepLab, type LabState } from '../../calc/lab';
import { CURRENCIES, type Currency } from '../../data/types';
import { h } from '../../ui/dom';
import { animator } from '../common';
import type { PanelFactory } from '../types';

const NAMES: Record<Currency, string> = { USD: 'United States', EUR: 'Euro area', GBP: 'United Kingdom', JPY: 'Japan', CHF: 'Switzerland', AUD: 'Australia', CAD: 'Canada', NZD: 'New Zealand' };
const C = {
  bg: '#0b0c0e',
  glass: '#313740',
  text: '#e8eaed',
  dim: '#8a9099',
  high: [44, 154, 216] as const,
  low: [161, 95, 224] as const,
  mid: [86, 91, 99] as const,
  income: [44, 154, 216] as const,
  spending: [25, 158, 112] as const,
  savings: [170, 150, 236] as const,
  flow: [214, 218, 224] as const,
  trade: [150, 158, 170] as const,
};
const rgba = (c: readonly [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(3)})`;
const mono = (px: number, bold = false) => `${bold ? '600 ' : ''}${px}px ui-monospace, Menlo, Consolas, monospace`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pressureColor = (p: number, a: number) => {
  const k = Math.min(1, Math.abs(p - 50) / 50);
  const pole = p >= 50 ? C.high : C.low;
  return rgba([0, 1, 2].map((i) => Math.round(C.mid[i]! + (pole[i]! - C.mid[i]!) * k)) as [number, number, number], a);
};

/** Model time that passes per real second, and the size of each model step. */
const SPEED = 1.2;
const STEP = 0.05;

export const labPanel: PanelFactory = (body, footer) => {
  body.classList.add('weather-body', 'lab-body');
  let lab: LabState = createLab();
  let selected: Currency = 'USD';
  let width = 0;
  let height = 0;
  let dpr = 1;
  let carry = 0;
  let dash = 0;

  const chips = new Map<Currency, HTMLButtonElement>();
  const chipRow = h('div', { class: 'tf-bar', role: 'group', 'aria-label': 'Economy' });
  for (const c of CURRENCIES) {
    const b = h('button', { type: 'button', class: 'tf', title: NAMES[c] }, c);
    b.addEventListener('click', () => {
      selected = c;
      syncControls();
      redrawIfStill();
    });
    chips.set(c, b);
    chipRow.append(b);
  }
  const rate = h('input', { type: 'range', id: 'lab-rate', min: String(LAB.rateMin), max: String(LAB.rateMax), step: '0.25' });
  const tax = h('input', { type: 'range', id: 'lab-tax', min: String(LAB.taxMin), max: String(LAB.taxMax), step: '1' });
  const rateText = h('output', { for: 'lab-rate', class: 'mono' });
  const taxText = h('output', { for: 'lab-tax', class: 'mono' });
  const reset = h('button', { type: 'button', class: 'button' }, 'Reset the lab');
  const canvas = h('canvas', { class: 'wx-layer', role: 'img', 'aria-label': 'Teaching model: tanks for one economy, and money flowing between eight economies. The same numbers are in the table below.' });
  const host = h('div', { class: 'wx-host' }, canvas);
  const table = h('div', { class: 'lab-table' });

  body.append(
    h('div', { class: 'lab-banner', role: 'note' }, h('span', { class: 'replay-tag' }, 'TEACHING MODEL'), ' A simplified what-if. It is not a forecast and uses no market data: every economy starts identical, with round numbers that are not real interest or tax rates.'),
    h('div', { class: 'panel-toolbar wx-toolbar' }, chipRow, h('label', { class: 'lab-slider' }, 'Interest rate ', rate, rateText), h('label', { class: 'lab-slider' }, 'Tax rate ', tax, taxText), reset),
    host,
    table,
    h('p', { class: 'note wx-legend' }, 'Raise one economy\'s interest rate: its people spend less and save more, savings arrive from the other seven, and its pressure rises. Raise its tax rate: spending moves from households to government. Pressure here belongs to the model only and has nothing to do with the weather map\'s market readings.'),
  );

  const syncControls = () => {
    const e = lab.economies[selected];
    for (const [c, b] of chips) {
      b.classList.toggle('active', c === selected);
      b.setAttribute('aria-pressed', String(c === selected));
    }
    rate.value = String(e.rate);
    tax.value = String(e.tax);
    rateText.textContent = ` ${e.rate.toFixed(2)}%`;
    taxText.textContent = ` ${e.tax.toFixed(0)}%`;
  };

  rate.addEventListener('input', () => {
    lab = setPolicy(lab, selected, { rate: Number(rate.value) });
    syncControls();
    redrawIfStill();
  });
  tax.addEventListener('input', () => {
    lab = setPolicy(lab, selected, { tax: Number(tax.value) });
    syncControls();
    redrawIfStill();
  });
  reset.addEventListener('click', () => {
    lab = createLab();
    syncControls();
    redrawIfStill();
  });

  const tank = (g: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, level: number, color: readonly [number, number, number], time: number, mid = false) => {
    g.save();
    g.beginPath();
    g.rect(x, y, w, hgt);
    g.fillStyle = 'rgba(17, 19, 23, 0.95)';
    g.fill();
    g.clip();
    const surface = y + hgt * (1 - clamp01(level));
    const amp = Math.min(2.5, hgt * 0.012);
    g.beginPath();
    g.moveTo(x, y + hgt);
    for (let i = 0; i <= 16; i++) g.lineTo(x + (w * i) / 16, surface + Math.sin(time * 1.5 + i * 0.8 + x) * amp);
    g.lineTo(x + w, y + hgt);
    g.closePath();
    const grad = g.createLinearGradient(0, surface, 0, y + hgt);
    grad.addColorStop(0, rgba(color, 0.85));
    grad.addColorStop(1, rgba(color, 0.3));
    g.fillStyle = grad;
    g.fill();
    g.restore();
    g.strokeStyle = C.glass;
    g.lineWidth = 1.5;
    g.strokeRect(x, y, w, hgt);
    if (mid) {
      // The trade tank is half full when trade is balanced.
      g.strokeStyle = 'rgba(232, 234, 237, 0.45)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x, y + hgt / 2);
      g.lineTo(x + w, y + hgt / 2);
      g.stroke();
      g.setLineDash([]);
    }
  };

  const draw = (time: number) => {
    const g = canvas.getContext('2d');
    if (!g || width === 0) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, width, height);
    const small = Math.max(9, Math.min(12, height / 26));
    const e = lab.economies[selected];

    // Left: inside the selected economy.
    const leftW = width * 0.46;
    const pad = small * 1.4;
    g.font = mono(small * 0.95);
    g.fillStyle = C.dim;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(`INSIDE ${NAMES[selected].toUpperCase()} (${selected})`, pad, pad + small * 0.4);
    const tanks = [
      { label: 'INCOME', value: e.income, level: e.income / 150, color: C.income, mid: false },
      { label: 'SPENDING', value: e.spending, level: e.spending / 90, color: C.spending, mid: false },
      { label: 'SAVINGS', value: e.savings, level: e.savings / (e.savings + 100), color: C.savings, mid: false },
      { label: 'TRADE', value: e.trade, level: 0.5 + e.trade / 16, color: C.trade, mid: true },
    ];
    const top = pad + small * 3.6;
    const tankH = Math.max(40, height - top - small * 3.4);
    const gap = small * 1.1;
    const tankW = (leftW - pad * 2 - gap * 3) / 4;
    tanks.forEach((t, i) => {
      const x = pad + i * (tankW + gap);
      tank(g, x, top, tankW, tankH, t.level, t.color, time, t.mid);
      g.font = mono(small * 0.85);
      g.fillStyle = C.dim;
      g.textAlign = 'center';
      g.fillText(t.label, x + tankW / 2, top - small * 0.5);
      g.font = mono(small, true);
      g.fillStyle = C.text;
      g.fillText(`${t.mid && t.value > 0 ? '+' : ''}${t.value.toFixed(1)}`, x + tankW / 2, top + tankH + small * 1.3);
    });
    // The two valves, drawn above the tanks they act on.
    const valve = (cx: number, label: string, fraction: number) => {
      const cy = top - small * 2.1;
      const r = small * 0.75;
      g.strokeStyle = C.text;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      const a = -Math.PI * 0.75 + fraction * Math.PI * 1.5 - Math.PI / 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.stroke();
      g.font = mono(small * 0.85);
      g.fillStyle = C.text;
      g.textAlign = 'left';
      g.fillText(label, cx + r + 4, cy + small * 0.3);
    };
    valve(pad + tankW + gap / 2, `TAX ${e.tax.toFixed(0)}%`, (e.tax - LAB.taxMin) / (LAB.taxMax - LAB.taxMin));
    valve(pad + 2 * tankW + gap * 1.5, `RATE ${e.rate.toFixed(2)}%`, (e.rate - LAB.rateMin) / (LAB.rateMax - LAB.rateMin));

    // Right: the eight economies and the money moving between them.
    const cx = leftW + (width - leftW) / 2;
    const cy = height / 2 + small * 1.1;
    const rx = (width - leftW) / 2 - small * 4.6;
    const ry = height / 2 - small * 5.4;
    g.font = mono(small * 0.95);
    g.fillStyle = C.dim;
    g.textAlign = 'left';
    g.fillText('BETWEEN ECONOMIES · MODEL PRESSURE', leftW + pad * 0.5, pad + small * 0.4);
    const at = (c: Currency): [number, number] => {
      const a = (CURRENCIES.indexOf(c) / CURRENCIES.length) * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    };
    const biggest = Math.max(1e-6, ...lab.flows.map((f) => f.amount));
    for (const f of lab.flows) {
      const [x0, y0] = at(f.from);
      const [x1, y1] = at(f.to);
      const share = f.amount / biggest;
      g.strokeStyle = rgba(C.flow, 0.1 + 0.22 * share);
      g.lineWidth = 1 + 5 * share;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      const len = Math.hypot(x1 - x0, y1 - y0);
      g.setLineDash([6, 12]);
      g.lineDashOffset = -dash * (30 + 90 * share) * (len > 0 ? 1 : 0);
      g.strokeStyle = rgba(C.flow, 0.85);
      g.lineWidth = Math.max(1, 0.6 + 2.4 * share);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
    const nodeR = Math.max(13, Math.min(rx, ry) * 0.2);
    for (const c of CURRENCIES) {
      const [x, y] = at(c);
      const eco = lab.economies[c];
      g.beginPath();
      g.arc(x, y, nodeR, 0, Math.PI * 2);
      g.fillStyle = C.bg;
      g.fill();
      g.fillStyle = pressureColor(eco.pressure, 0.75);
      g.fill();
      g.strokeStyle = c === selected ? C.text : pressureColor(eco.pressure, 1);
      g.lineWidth = c === selected ? 2 : 1;
      g.stroke();
      g.font = mono(small * 0.95, true);
      g.fillStyle = C.text;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(c, x, y - small * 0.45);
      g.font = mono(small * 0.85);
      g.fillText(`${eco.pressure >= 60 ? 'H ' : eco.pressure <= 40 ? 'L ' : ''}${eco.pressure.toFixed(0)}`, x, y + small * 0.65);
      g.fillStyle = C.dim;
      g.fillText(`${eco.rate.toFixed(2)}%`, x, y + nodeR + small * 0.9);
      g.textBaseline = 'alphabetic';
    }
  };

  const renderTable = () => {
    const t = h('table', {}, h('thead', {}, h('tr', {}, ...['Economy', 'Rate', 'Tax', 'Income', 'Spending', 'Savings', 'Trade', 'Money in', 'Pressure'].map((x, i) => h('th', { class: i === 0 ? '' : 'num' }, x)))));
    const tb = h('tbody', {});
    for (const c of CURRENCIES) {
      const e = lab.economies[c];
      const sign = (v: number) => `${v > 0.005 ? '+' : v < -0.005 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
      tb.append(
        h('tr', { class: c === selected ? 'selected' : '', 'data-economy': c, 'data-pressure': e.pressure.toFixed(1), 'data-capital': e.capital.toFixed(3) },
          h('td', {}, c), h('td', { class: 'num' }, `${e.rate.toFixed(2)}%`), h('td', { class: 'num' }, `${e.tax.toFixed(0)}%`), h('td', { class: 'num' }, e.income.toFixed(1)), h('td', { class: 'num' }, e.spending.toFixed(1)),
          h('td', { class: 'num' }, e.savings.toFixed(1)), h('td', { class: 'num' }, sign(e.trade)), h('td', { class: 'num' }, sign(e.capital)), h('td', { class: 'num' }, e.pressure.toFixed(0))),
      );
    }
    t.append(tb);
    table.replaceChildren(t);
    footer.textContent = `Teaching model · not market data · model time ${lab.time.toFixed(1)}`;
  };

  let sinceTable = 0;
  const anim = animator(host, {
    ready: () => width > 0,
    frame: (now, dt) => {
      carry += dt * SPEED;
      while (carry >= STEP) {
        lab = stepLab(lab, STEP);
        carry -= STEP;
      }
      dash += dt;
      draw(now / 1000);
      sinceTable += dt;
      if (sinceTable > 0.25) {
        sinceTable = 0;
        renderTable();
      }
    },
    still: () => {
      draw(0);
      renderTable();
    },
  });

  /** Without animation there is no clock, so a change is run forward to where it settles. */
  function redrawIfStill(): void {
    if (anim.isRunning()) return;
    lab = runLab(lab, 600, STEP);
    draw(0);
    renderTable();
  }

  const resizeObserver = new ResizeObserver(() => {
    const rect = host.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    width = rect.width;
    height = rect.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    anim.sync();
    if (!anim.isRunning()) draw(0);
  });
  resizeObserver.observe(host);
  syncControls();
  renderTable();

  return {
    destroy() {
      anim.stop();
      resizeObserver.disconnect();
    },
  };
};
