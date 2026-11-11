/**
 * Weather map: currency strength drawn as weather.
 *
 *  pressure  strength score. Isobars ring each region; H marks a strong
 *            currency, L a weak one.
 *  wind      change in strength. Streams flow out of currencies that are
 *            losing strength and into those gaining it.
 *  storm     volatility against the currency's own average. Clouds swirl
 *            over busy currencies; lightning marks the busiest.
 *
 * Drawing only: every number comes from weatherView. The animation is a
 * stylised 2D effect, pauses when the panel or tab is hidden, and is
 * replaced by a still picture when the system asks for reduced motion.
 */
import { weatherView, type WeatherView } from '../../app/analysis';
import { contourSegments } from '../../calc/contour';
import type { CurrencyWeather, StormLevel } from '../../calc/weather';
import { CURRENCIES, type Currency } from '../../data/types';
import { h } from '../../ui/dom';
import { choiceBar, emptyState, live, loadedFooter } from '../common';
import type { PanelFactory } from '../types';
import { MAP_ASPECT, SIGMA, STATIONS, influence, project } from './geo';
import mapData from './mapData.json';

const LOOKBACKS = [
  { value: 4, text: '4H' },
  { value: 24, text: '24H' },
  { value: 168, text: '1W' },
  { value: 720, text: '1M' },
] as const;

const COLORS = {
  ocean: '#080b10',
  grid: 'rgba(120, 140, 170, 0.07)',
  land: '#111821',
  coast: '#27323f',
  high: [79, 200, 225] as const,
  low: [132, 120, 230] as const,
  text: '#d5dce6',
  dim: '#7a8594',
  up: '#3fb27f',
  down: '#e0605a',
  cloud: [205, 213, 224] as const,
  bolt: '#ffe9a8',
  gold: '#d9a441',
};

const GRID_COLS = 132;
const GRID_ROWS = Math.round(GRID_COLS / MAP_ASPECT);
const LEVELS = [0.12, 0.26, 0.42, 0.6, 0.8];
const TRANSITION_MS = 450;
const MAX_WIND = 5;
const rgba = (c: readonly [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(3)})`;
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

interface Reading {
  pressure: number;
  wind: number;
  storm: number;
  level: StormLevel;
  known: boolean;
}

interface Particle {
  x: number;
  y: number;
  age: number;
  life: number;
}

interface Bolt {
  currency: Currency;
  until: number;
  points: number[];
}

const NEUTRAL: Reading = { pressure: 50, wind: 0, storm: 1, level: 'calm', known: false };
const LEVEL_WORD: Record<StormLevel, string> = { calm: 'calm', breezy: 'breezy', stormy: 'storm', severe: 'severe storm' };

export const weatherPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;
  body.classList.add('weather-body');
  const lookback = choiceBar<number>('Lookback', LOOKBACKS, (hours) => state.update({ strengthLookbackHours: hours }));
  const tfNote = h('span', { class: 'dim' });
  const base = h('canvas', { class: 'wx-layer' });
  const windLayer = h('canvas', { class: 'wx-layer' });
  const top = h('canvas', { class: 'wx-layer', role: 'img', 'aria-label': 'World map of currency strength drawn as weather. The same readings are listed below the map.' });
  const host = h('div', { class: 'wx-host' }, base, windLayer, top);
  const readout = h('div', { class: 'wx-readout' });
  const legend = h('p', { class: 'dim wx-legend' });
  const empty = h('div', { class: 'wx-empty', hidden: true });
  body.append(h('div', { class: 'panel-toolbar wx-toolbar' }, h('span', { class: 'dim' }, 'Lookback'), lookback.el, tfNote), host, empty, readout, legend);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stations = Object.fromEntries(CURRENCIES.map((c) => [c, { c: project(STATIONS[c].lon, STATIONS[c].lat), a: project(STATIONS[c].anchorLon, STATIONS[c].anchorLat) }])) as Record<Currency, { c: [number, number]; a: [number, number] }>;

  // Readings: what the data says (target) and what is on screen (shown), eased between.
  let from = Object.fromEntries(CURRENCIES.map((c) => [c, { ...NEUTRAL }])) as Record<Currency, Reading>;
  let target = from;
  let shown = from;
  let transitionStart = 0;
  let hasData = false;

  // Canvas geometry in CSS pixels.
  let width = 0;
  let height = 0;
  let dpr = 1;
  let map = { x: 0, y: 0, w: 0, h: 0 };
  let landPath: Path2D | null = null;
  let regionPaths = {} as Record<Currency, Path2D>;
  let baseDirty = true;
  const particles: Particle[] = [];
  const bolts: Bolt[] = [];
  const px = (p: [number, number]): [number, number] => [map.x + p[0] * map.w, map.y + p[1] * map.h];

  const ringsToPath = (rings: number[][]): Path2D => {
    const path = new Path2D();
    for (const ring of rings) {
      let prevX = 0;
      for (let i = 0; i < ring.length; i += 2) {
        const [x, y] = px(project(ring[i]!, ring[i + 1]!));
        // A jump of more than half the map means the outline crossed the map's edge: lift the pen.
        if (i === 0 || Math.abs(x - prevX) > map.w / 2) path.moveTo(x, y);
        else path.lineTo(x, y);
        prevX = x;
      }
      path.closePath();
    }
    return path;
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    width = rect.width;
    height = rect.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [base, windLayer, top]) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const w = Math.min(width, height * MAP_ASPECT);
    map = { w, h: w / MAP_ASPECT, x: (width - w) / 2, y: (height - w / MAP_ASPECT) / 2 };
    landPath = ringsToPath(mapData.land);
    regionPaths = Object.fromEntries(CURRENCIES.map((c) => [c, ringsToPath((mapData.regions as Record<string, number[][]>)[c] ?? [])])) as Record<Currency, Path2D>;
    particles.length = 0;
    baseDirty = true;
    if (!running) renderStill();
  };

  const pressureColor = (pressure: number, alpha: number) => {
    const k = Math.abs(pressure - 50) / 50;
    return rgba(pressure >= 50 ? COLORS.high : COLORS.low, alpha * (0.25 + 0.75 * k));
  };

  /** The pressure field: each currency pushes the surface up (strong) or down (weak). */
  const pressureGrid = (): Float32Array => {
    const values = new Float32Array(GRID_COLS * GRID_ROWS);
    const active = CURRENCIES.filter((c) => shown[c].known).map((c) => ({ amp: (shown[c].pressure - 50) / 50, at: stations[c].c }));
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const x = col / (GRID_COLS - 1);
        const y = r / (GRID_ROWS - 1);
        let v = 0;
        for (const s of active) v += s.amp * influence(x, y, s.at[0], s.at[1]);
        values[r * GRID_COLS + col] = v;
      }
    }
    return values;
  };

  const drawBase = () => {
    const g = base.getContext('2d');
    if (!g || !landPath) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COLORS.ocean;
    g.fillRect(0, 0, width, height);

    // Graticule every 30 degrees.
    g.strokeStyle = COLORS.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let lon = -150; lon <= 180; lon += 30) {
      const [x] = px(project(lon, 0));
      g.moveTo(x, map.y);
      g.lineTo(x, map.y + map.h);
    }
    for (let lat = -30; lat <= 60; lat += 30) {
      const [, y] = px(project(0, lat));
      g.moveTo(map.x, y);
      g.lineTo(map.x + map.w, y);
    }
    g.stroke();

    g.fillStyle = COLORS.land;
    g.fill(landPath);
    g.strokeStyle = COLORS.coast;
    g.lineWidth = 0.75;
    g.stroke(landPath);

    // Each currency's region, tinted by its pressure.
    for (const c of CURRENCIES) {
      if (!shown[c].known) continue;
      g.fillStyle = pressureColor(shown[c].pressure, 0.55);
      g.fill(regionPaths[c]);
      g.strokeStyle = pressureColor(shown[c].pressure, 0.9);
      g.lineWidth = 0.75;
      g.stroke(regionPaths[c]);
    }

    // Isobars.
    const grid = { cols: GRID_COLS, rows: GRID_ROWS, values: pressureGrid() };
    const sx = map.w / (GRID_COLS - 1);
    const sy = map.h / (GRID_ROWS - 1);
    g.save();
    g.beginPath();
    g.rect(map.x, map.y, map.w, map.h);
    g.clip();
    g.lineWidth = 1;
    LEVELS.forEach((level, i) => {
      for (const sign of [1, -1]) {
        const seg = contourSegments(grid, level * sign);
        if (seg.length === 0) continue;
        g.strokeStyle = rgba(sign > 0 ? COLORS.high : COLORS.low, 0.28 + 0.14 * i);
        g.beginPath();
        for (let k = 0; k < seg.length; k += 4) {
          g.moveTo(map.x + seg[k]! * sx, map.y + seg[k + 1]! * sy);
          g.lineTo(map.x + seg[k + 2]! * sx, map.y + seg[k + 3]! * sy);
        }
        g.stroke();
      }
    });
    g.restore();

    // Leader lines from displaced systems back to their region.
    g.strokeStyle = 'rgba(213, 220, 230, 0.35)';
    g.setLineDash([2, 3]);
    g.beginPath();
    for (const c of CURRENCIES) {
      const [cx, cy] = px(stations[c].c);
      const [ax, ay] = px(stations[c].a);
      if (Math.hypot(cx - ax, cy - ay) < 6) continue;
      g.moveTo(cx, cy);
      g.lineTo(ax, ay);
    }
    g.stroke();
    g.setLineDash([]);
    baseDirty = false;
  };

  /** Wind at a map position: toward currencies gaining strength, away from those losing it. */
  const windAt = (x: number, y: number): [number, number] => {
    let vx = 0;
    let vy = 0;
    for (const c of CURRENCIES) {
      const r = shown[c];
      if (!r.known) continue;
      const [cx, cy] = stations[c].c;
      const k = (r.wind / 100) * influence(x, y, cx, cy) / (SIGMA * SIGMA);
      vx += k * (cx - x);
      vy += (k * (cy - y)) / MAP_ASPECT;
    }
    return [vx, vy * MAP_ASPECT];
  };

  const spawn = (p: Particle) => {
    p.x = Math.random();
    p.y = Math.random();
    p.age = 0;
    p.life = 1.5 + Math.random() * 3;
  };

  const drawWind = (dt: number) => {
    const g = windLayer.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fade what is there, leaving short trails.
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0, 0, 0, ${Math.min(1, dt * 3.2).toFixed(3)})`;
    g.fillRect(0, 0, width, height);
    g.globalCompositeOperation = 'source-over';

    const wanted = Math.round(Math.min(700, Math.max(160, (map.w * map.h) / 900)));
    while (particles.length < wanted) {
      const p = { x: 0, y: 0, age: 0, life: 1 };
      spawn(p);
      p.age = Math.random() * p.life;
      particles.push(p);
    }
    particles.length = wanted;
    g.lineWidth = 1;
    g.lineCap = 'round';
    for (const p of particles) {
      let [vx, vy] = windAt(p.x, p.y);
      let speed = Math.hypot(vx, vy);
      if (speed > MAX_WIND) {
        // A gale is still drawn as a stream, not as lines across the map.
        vx *= MAX_WIND / speed;
        vy *= MAX_WIND / speed;
        speed = MAX_WIND;
      }
      const nx = p.x + vx * 0.014 * dt;
      const ny = p.y + vy * 0.014 * dt;
      if (speed > 0.15) {
        const fade = Math.min(1, p.age * 3, (p.life - p.age) * 3);
        g.strokeStyle = `rgba(200, 228, 240, ${(Math.min(0.6, 0.1 + speed * 0.1) * Math.max(0, fade)).toFixed(3)})`;
        g.beginPath();
        g.moveTo(map.x + p.x * map.w, map.y + p.y * map.h);
        g.lineTo(map.x + nx * map.w, map.y + ny * map.h);
        g.stroke();
      }
      p.x = nx;
      p.y = ny;
      p.age += dt;
      if (p.age > p.life || nx < 0 || nx > 1 || ny < 0 || ny > 1) spawn(p);
    }
  };

  /** Still picture of the wind for reduced motion: short arrows on a grid. */
  const drawWindStill = () => {
    const g = windLayer.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    g.strokeStyle = 'rgba(200, 228, 240, 0.5)';
    g.lineWidth = 1;
    for (let gx = 0.03; gx < 1; gx += 0.045) {
      for (let gy = 0.06; gy < 1; gy += 0.11) {
        const [vx, vy] = windAt(gx, gy);
        const speed = Math.hypot(vx, vy);
        if (speed < 0.4) continue;
        const len = Math.min(14, 3 + speed * 2.2);
        const ux = vx / speed;
        const uy = vy / speed;
        const x = map.x + gx * map.w;
        const y = map.y + gy * map.h;
        g.beginPath();
        g.moveTo(x - ux * len, y - uy * len);
        g.lineTo(x + ux * len, y + uy * len);
        g.lineTo(x + ux * len - (ux + uy) * 3, y + uy * len - (uy - ux) * 3);
        g.stroke();
      }
    }
  };

  const drawStormsAndLabels = (now: number, dt: number, animate: boolean) => {
    const g = top.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const unit = map.w;

    for (const c of CURRENCIES) {
      const r = shown[c];
      if (!r.known) continue;
      const [cx, cy] = px(stations[c].c);
      const strength = Math.max(0, Math.min(1, (r.storm - 1) / 0.9));
      if (r.storm >= 1.1) {
        const radius = unit * (0.022 + 0.04 * strength);
        const cloud = g.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.25);
        cloud.addColorStop(0, rgba(COLORS.cloud, 0.1 + 0.22 * strength));
        cloud.addColorStop(1, rgba(COLORS.cloud, 0));
        g.fillStyle = cloud;
        g.beginPath();
        g.arc(cx, cy, radius * 1.25, 0, Math.PI * 2);
        g.fill();
        // Spiral arms, turning faster as the storm strengthens.
        const turn = animate ? (now / 1000) * (0.5 + 1.8 * strength) : 0.6;
        g.strokeStyle = rgba(COLORS.cloud, 0.3 + 0.5 * strength);
        g.lineWidth = 1 + strength;
        for (let arm = 0; arm < 3; arm++) {
          g.beginPath();
          for (let s = 0; s <= 22; s++) {
            const t = s / 22;
            const a = turn + (arm * Math.PI * 2) / 3 + t * 3.4;
            const rr = radius * (0.14 + 0.86 * t);
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (s === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
        // Lightning for storms and severe storms.
        if (r.level === 'stormy' || r.level === 'severe') {
          if (animate) {
            const perSecond = r.level === 'severe' ? 1.8 : 0.7;
            if (Math.random() < perSecond * dt) {
              const pts: number[] = [];
              let x = cx + (Math.random() - 0.5) * radius * 0.8;
              let y = cy - radius * 0.5;
              pts.push(x, y);
              for (let s = 0; s < 5; s++) {
                x += (Math.random() - 0.5) * radius * 0.5;
                y += radius * 0.28;
                pts.push(x, y);
              }
              bolts.push({ currency: c, until: now + 130, points: pts });
            }
          } else {
            g.fillStyle = COLORS.bolt;
            g.font = `${Math.round(radius * 0.9)}px sans-serif`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText('⚡', cx, cy);
          }
        }
      }
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]!;
      if (b.until < now) {
        bolts.splice(i, 1);
        continue;
      }
      g.strokeStyle = COLORS.bolt;
      g.lineWidth = 1.6;
      g.shadowColor = COLORS.bolt;
      g.shadowBlur = 8;
      g.beginPath();
      for (let k = 0; k < b.points.length; k += 2) {
        if (k === 0) g.moveTo(b.points[k]!, b.points[k + 1]!);
        else g.lineTo(b.points[k]!, b.points[k + 1]!);
      }
      g.stroke();
      g.shadowBlur = 0;
    }

    // Labels: H or L, the currency and its three readings.
    const small = Math.max(9, Math.min(11.5, unit / 80));
    for (const c of CURRENCIES) {
      const r = shown[c];
      const [cx, cy] = px(stations[c].c);
      const side = STATIONS[c].label === 'left' ? -1 : 1;
      if (r.known && (r.pressure >= 60 || r.pressure <= 40)) {
        g.font = `600 ${Math.round(small * 1.9)}px ui-monospace, Menlo, Consolas, monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = pressureColor(r.pressure, 1);
        g.fillText(r.pressure >= 60 ? 'H' : 'L', cx, cy);
      } else {
        g.fillStyle = COLORS.dim;
        g.beginPath();
        g.arc(cx, cy, 2, 0, Math.PI * 2);
        g.fill();
      }
      const line1 = r.known ? `${c} ${Math.round(r.pressure)}` : `${c} no data`;
      const windText = !r.known ? '' : Math.abs(r.wind) < 1 ? '• 0' : `${r.wind > 0 ? '▲' : '▼'} ${r.wind > 0 ? '+' : '−'}${Math.abs(r.wind).toFixed(0)}`;
      const stormText = r.known ? `${r.storm.toFixed(2)}×` : '';
      g.font = `600 ${small}px ui-monospace, Menlo, Consolas, monospace`;
      const w1 = g.measureText(line1).width;
      g.font = `${small}px ui-monospace, Menlo, Consolas, monospace`;
      const w2 = g.measureText(`${windText}  ${stormText}`).width;
      const boxW = Math.max(w1, w2) + 8;
      const boxH = small * 2.5 + 4;
      const gap = small * 1.6;
      const bx = side < 0 ? cx - gap - boxW : cx + gap;
      const by = cy - boxH / 2;
      g.fillStyle = 'rgba(7, 9, 12, 0.72)';
      g.fillRect(bx, by, boxW, boxH);
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.font = `600 ${small}px ui-monospace, Menlo, Consolas, monospace`;
      g.fillStyle = COLORS.text;
      g.fillText(line1, bx + 4, by + 3);
      if (r.known) {
        g.font = `${small}px ui-monospace, Menlo, Consolas, monospace`;
        g.fillStyle = Math.abs(r.wind) < 1 ? COLORS.dim : r.wind > 0 ? COLORS.up : COLORS.down;
        g.fillText(windText, bx + 4, by + 3 + small * 1.25);
        g.fillStyle = r.level === 'calm' ? COLORS.dim : r.level === 'breezy' ? COLORS.text : COLORS.gold;
        g.fillText(stormText, bx + 4 + g.measureText(`${windText}  `).width, by + 3 + small * 1.25);
      }
    }
  };

  /** Move the on-screen readings toward the data. Returns true while still moving. */
  const ease = (now: number): boolean => {
    const k = Math.min(1, (now - transitionStart) / TRANSITION_MS);
    const e = k * k * (3 - 2 * k);
    shown = Object.fromEntries(
      CURRENCIES.map((c) => {
        const a = from[c];
        const b = target[c];
        // A currency appearing or disappearing snaps; everything else glides.
        const glide = a.known && b.known;
        return [c, glide ? { pressure: mix(a.pressure, b.pressure, e), wind: mix(a.wind, b.wind, e), storm: mix(a.storm, b.storm, e), level: b.level, known: true } : b];
      }),
    ) as Record<Currency, Reading>;
    return k < 1;
  };

  let running = false;
  let frame = 0;
  let last = 0;
  let onScreen = true;

  const tick = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (ease(now)) baseDirty = true;
    if (baseDirty) drawBase();
    drawWind(dt);
    drawStormsAndLabels(now, dt, true);
    frame = requestAnimationFrame(tick);
  };

  const renderStill = () => {
    if (width === 0 || !hasData) return;
    shown = target;
    drawBase();
    drawWindStill();
    drawStormsAndLabels(performance.now(), 0, false);
  };

  /** Run the animation only when it can be seen and motion is wanted. */
  const sync = () => {
    const want = hasData && onScreen && document.visibilityState === 'visible' && !reducedMotion.matches && width > 0;
    if (want && !running) {
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    } else if (!want && running) {
      running = false;
      cancelAnimationFrame(frame);
    }
    if (!want) renderStill();
  };

  const resizeObserver = new ResizeObserver(() => {
    resize();
    sync();
  });
  resizeObserver.observe(host);
  const seen = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    sync();
  });
  seen.observe(host);
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', sync);

  const apply = (view: WeatherView) => {
    const next = Object.fromEntries(CURRENCIES.map((c) => [c, { ...NEUTRAL }])) as Record<Currency, Reading>;
    for (const w of view.currencies) {
      if (w.pressure === null) continue;
      next[w.currency] = { pressure: w.pressure, wind: w.wind ?? 0, storm: w.storm ?? 1, level: w.level, known: true };
    }
    from = shown;
    target = next;
    transitionStart = performance.now();
    baseDirty = true;
  };

  const chip = (w: CurrencyWeather): HTMLElement => {
    const wind = w.wind === null ? 'no wind reading' : Math.abs(w.wind) < 1 ? 'steady' : `${w.wind > 0 ? '▲ +' : '▼ −'}${Math.abs(w.wind).toFixed(0)}`;
    const windClass = w.wind === null || Math.abs(w.wind) < 1 ? 'dim' : w.wind > 0 ? 'up' : 'down';
    return h(
      'span',
      { class: `wx-chip level-${w.level}`, 'data-currency': w.currency },
      h('span', { class: 'wx-ccy' }, w.currency),
      h('span', { class: 'wx-pressure', title: 'Pressure: strength score, 0 to 100' }, w.pressure === null ? '–' : w.pressure.toFixed(0)),
      h('span', { class: windClass, title: `Wind: change in strength over the last bars` }, wind),
      h('span', { class: 'wx-storm', title: 'Storm: volatility against its own average' }, w.storm === null ? 'no storm reading' : `${LEVEL_WORD[w.level]} ${w.storm.toFixed(2)}×`),
    );
  };

  return live(
    ctx,
    async (current) => {
      const { timeframe, strengthLookbackHours, atrPeriod, volatilityBaselineDays, displayZone } = state.settings;
      lookback.set(strengthLookbackHours);
      tfNote.textContent = `on ${timeframe} bars`;
      const view = await weatherView(hub, timeframe, strengthLookbackHours, atrPeriod, volatilityBaselineDays);
      if (!current()) return;
      footer.textContent = loadedFooter(view.strength.loaded, displayZone, 28);

      if (view.currencies.length === 0) {
        hasData = false;
        host.hidden = true;
        empty.hidden = false;
        empty.replaceChildren(emptyState('The weather map cannot be drawn.', view.strength.reason ?? '', { label: 'Open Files', run: () => ctx.run('FILES') }));
        readout.replaceChildren();
        legend.textContent = '';
        sync();
        return;
      }
      host.hidden = false;
      empty.hidden = true;
      const first = !hasData;
      hasData = true;
      if (width === 0) resize();
      apply(view);
      if (first) {
        shown = target; // nothing to glide from on the first draw
        from = target;
      }
      readout.replaceChildren(...view.currencies.map(chip));
      legend.textContent = `Pressure is the strength score (H strong, L weak). Wind is the change in that score over the last ${view.windBars} ${timeframe} bars: streams flow toward currencies gaining strength. Storm is each currency's average volatility against its own usual level (1.00× is usual).`;
      sync();
    },
    () => {
      running = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      seen.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
    },
  );
};
