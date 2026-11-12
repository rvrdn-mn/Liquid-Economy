/**
 * Chart panel: candlesticks for the selected instrument and timeframe.
 * Drawing only. Bars come from the hub; nothing is computed here.
 */
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar, BarSeries, InstrumentId, Timeframe } from '../data/types';
import { formatAge, formatDate, formatDateTime, h, zoneLabel, type Zone } from '../ui/dom';
import type { PanelFactory } from './types';

const COLORS = {
  text: '#8a9099',
  grid: '#181b20',
  border: '#22262d',
  up: '#2fa87a',
  down: '#e66767',
  gold: '#d4af37',
  line: '#b9bdc4',
  mark: '#b9bdc4',
};

function precision(instrument: InstrumentId): number {
  if (instrument === 'XAUUSD') return 2;
  return instrument.endsWith('JPY') ? 3 : 5;
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Axis labels in the chosen zone. Daily stamps are dates and are not shifted. */
function tickLabel(time: Time, type: TickMarkType, zone: Zone, daily: boolean): string {
  const d = new Date((time as number) * 1000);
  const utc = zone === 'utc' || daily;
  const year = utc ? d.getUTCFullYear() : d.getFullYear();
  const month = utc ? d.getUTCMonth() : d.getMonth();
  const day = utc ? d.getUTCDate() : d.getDate();
  const hours = utc ? d.getUTCHours() : d.getHours();
  const minutes = utc ? d.getUTCMinutes() : d.getMinutes();
  switch (type) {
    case TickMarkType.Year:
      return String(year);
    case TickMarkType.Month:
      return MONTHS[month]!;
    case TickMarkType.DayOfMonth:
      return `${day} ${MONTHS[month]}`;
    default:
      return `${pad(hours)}:${pad(minutes)}`;
  }
}

export const chartPanel: PanelFactory = (body, footer, ctx) => {
  const { state, hub } = ctx;

  const symbol = h('span', { class: 'chart-symbol' });
  const legend = h('div', { class: 'chart-legend' });
  // Journal trades are drawn on request. They start on for your own history and off for the demo one.
  let showTrades: boolean | null = null;
  const tradesToggle = h('button', { type: 'button', class: 'btn btn-quiet trades-toggle', 'aria-pressed': 'false', title: 'Mark journal trades on the chart' }, 'Trades');
  tradesToggle.addEventListener('click', () => {
    showTrades = !(showTrades ?? (hub.journal?.demo === false || state.workspace === 'journal'));
    void reload();
  });
  const demoNote = h('span', { class: 'replay-tag', hidden: true, title: 'The trade marks on this chart are the invented demo journal, not real trades' }, 'DEMO TRADES');
  const toolbar = h('div', { class: 'chart-toolbar' }, symbol, tradesToggle, demoNote, legend);
  const canvasHost = h('div', { class: 'chart-host' });
  const empty = h('div', { class: 'panel-empty', hidden: true });
  body.classList.add('chart-body');
  body.append(toolbar, h('div', { class: 'chart-area' }, canvasHost, empty));

  let daily = false;
  const chart: IChartApi = createChart(canvasHost, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: COLORS.text,
      fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
      fontSize: 11,
      attributionLogo: true,
    },
    grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: COLORS.border },
    timeScale: {
      borderColor: COLORS.border,
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time: Time, type: TickMarkType) => tickLabel(time, type, state.settings.displayZone, daily),
    },
    localization: {
      timeFormatter: (time: Time) =>
        daily ? formatDate(time as number) : `${formatDateTime(time as number, state.settings.displayZone)} ${zoneLabel(state.settings.displayZone)}`,
    },
  });

  let series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null = null;
  let shown: BarSeries | null = null;
  let shownKey = '';
  const byTime = new Map<number, Bar>();

  const writeLegend = (bar: Bar | undefined) => {
    legend.replaceChildren();
    if (!bar || !shown) return;
    const p = precision(shown.instrument);
    if (shown.source.closeOnly) {
      legend.append(h('span', {}, `Rate ${bar.close.toFixed(p)}`));
      return;
    }
    const cls = bar.close >= bar.open ? 'up' : 'down';
    for (const [k, v] of [['O', bar.open], ['H', bar.high], ['L', bar.low], ['C', bar.close]] as const) {
      legend.append(h('span', { class: 'ohlc' }, h('span', { class: 'dim' }, k), h('span', { class: cls }, v.toFixed(p))));
    }
  };

  chart.subscribeCrosshairMove((param) => {
    const last = shown?.bars[shown.bars.length - 1];
    writeLegend(param.time !== undefined ? (byTime.get(param.time as number) ?? last) : last);
  });

  /** Journal trades for this instrument as entry and exit marks on the bars they fall in. */
  const tradeMarkers = (data: BarSeries): SeriesMarker<Time>[] => {
    const bars = data.bars;
    const first = bars[0]!.time;
    const span = bars.length > 1 ? bars[bars.length - 1]!.time - bars[bars.length - 2]!.time : 0;
    const end = bars[bars.length - 1]!.time + span;
    /** Time of the bar a moment falls in: the last bar that starts at or before it. */
    const barOf = (time: number): number | null => {
      if (time < first || time > end) return null;
      let lo = 0;
      let hi = bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bars[mid]!.time <= time) lo = mid;
        else hi = mid - 1;
      }
      return bars[lo]!.time;
    };
    const out: SeriesMarker<Time>[] = [];
    for (const t of hub.getTrades(data.instrument)) {
      const entry = barOf(t.openTime);
      const buy = t.side === 'buy';
      if (entry !== null) {
        out.push({ time: entry as UTCTimestamp, position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: COLORS.mark, text: buy ? 'Buy' : 'Sell' });
      }
      const exit = t.closeTime === null ? null : barOf(t.closeTime);
      if (exit !== null && t.result !== null) {
        const won = t.result > 0;
        out.push({ time: exit as UTCTimestamp, position: buy ? 'aboveBar' : 'belowBar', shape: 'circle', color: won ? COLORS.up : t.result < 0 ? COLORS.down : COLORS.mark, text: `${t.result > 0 ? '+' : t.result < 0 ? '−' : ''}${Math.abs(t.result).toFixed(0)}` });
      }
    }
    // On a crowded chart the labels pile up, so only the shapes are kept.
    if (out.length > 16) for (const m of out) delete m.text;
    return out.sort((a, b) => (a.time as number) - (b.time as number));
  };

  const showEmpty = (instrument: InstrumentId, timeframe: Timeframe) => {
    if (series) {
      chart.removeSeries(series);
      series = null;
    }
    shown = null;
    shownKey = '';
    byTime.clear();
    legend.replaceChildren();
    demoNote.hidden = true;
    const available = hub.availableTimeframes(instrument);
    const lines: (Node | string)[] = [h('p', { class: 'empty-title' }, `No ${timeframe} data for ${instrument}.`)];
    if (available.length > 0) {
      const row = h('p', {}, 'Loaded for this instrument: ');
      for (const tf of available) {
        const b = h('button', { type: 'button', class: 'chip' }, tf);
        b.addEventListener('click', () => state.update({ timeframe: tf }));
        row.append(b);
      }
      lines.push(row);
      lines.push(h('p', { class: 'dim' }, 'The sample set has daily values only. Import a one-minute or hourly price file to see intraday charts.'));
    } else {
      lines.push(h('p', { class: 'dim' }, 'Nothing is loaded for this instrument. Import a price file to chart it.'));
    }
    const open = h('button', { type: 'button', class: 'button' }, 'Import files');
    open.addEventListener('click', () => ctx.run('FILES'));
    lines.push(open);
    empty.replaceChildren(...lines);
    empty.hidden = false;
    canvasHost.style.visibility = 'hidden';
    footer.textContent = 'No data loaded for this view.';
  };

  const show = (data: BarSeries) => {
    empty.hidden = true;
    canvasHost.style.visibility = 'visible';
    const viewKey = `${data.instrument}|${data.timeframe}|${data.source.closeOnly === true}|${data.source.replayAt !== undefined}`;
    const sameView = viewKey === shownKey && data.source.replayAt !== undefined;
    const range = sameView ? chart.timeScale().getVisibleLogicalRange() : null;
    const keepWidth = range ? Math.max(20, Math.round(range.to - range.from) - 5) : null;
    shownKey = viewKey;
    if (series) chart.removeSeries(series);
    daily = data.timeframe === 'D1';
    const p = precision(data.instrument);
    const priceFormat = { type: 'price' as const, precision: p, minMove: 1 / 10 ** p };
    byTime.clear();
    for (const b of data.bars) byTime.set(b.time, b);
    shown = data;

    if (data.source.closeOnly) {
      // One value per day: a line is honest, flat candles would not be.
      const line = chart.addSeries(LineSeries, { color: data.instrument === 'XAUUSD' ? COLORS.gold : COLORS.line, lineWidth: 2, priceFormat });
      line.setData(data.bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })));
      series = line;
    } else {
      const candles = chart.addSeries(CandlestickSeries, {
        upColor: COLORS.up,
        downColor: COLORS.down,
        wickUpColor: COLORS.up,
        wickDownColor: COLORS.down,
        borderVisible: false,
        priceFormat,
      });
      candles.setData(data.bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
      series = candles;
    }
    const tradesOn = showTrades ?? (hub.journal?.demo === false || state.workspace === 'journal');
    tradesToggle.setAttribute('aria-pressed', String(tradesOn));
    tradesToggle.classList.toggle('active', tradesOn);
    tradesToggle.hidden = hub.getTrades(data.instrument).length === 0;
    const markers = tradesOn ? tradeMarkers(data) : [];
    if (markers.length > 0 && series) createSeriesMarkers(series, markers);
    demoNote.hidden = !(markers.length > 0 && hub.journal?.demo === true);
    chart.applyOptions({ timeScale: { timeVisible: !daily } });
    const applyView = () => {
      if (shown !== data) return;
      chart.timeScale().fitContent();
      if (data.bars.length > 300) chart.timeScale().setVisibleLogicalRange({ from: data.bars.length - 220, to: data.bars.length + 5 });
    };
    if (sameView && keepWidth !== null) {
      // Replay step on the same chart: keep the zoom and follow the newest bar.
      chart.timeScale().setVisibleLogicalRange({ from: data.bars.length - keepWidth, to: data.bars.length + 5 });
    } else {
      applyView();
      // A panel that was just opened may not have its size yet; fit once more when it does.
      requestAnimationFrame(() => requestAnimationFrame(applyView));
    }
    const last = data.bars[data.bars.length - 1]!;
    writeLegend(last);
    const when = daily ? formatDate(last.time) : `${formatDateTime(data.source.asOf, state.settings.displayZone)} ${zoneLabel(state.settings.displayZone)}`;
    const parts = [data.source.label, `${data.bars.length} bars`, `last ${when}`, data.source.replayAt !== undefined ? 'replay' : formatAge(data.source.asOf)];
    if (data.source.closeOnly) parts.push('one value per bar, no high or low');
    footer.textContent = parts.join(' · ');
    footer.title = data.source.note ?? '';
  };

  /** A dashed line at the live gold price. Never part of the bars, and never shown during replay. */
  let liveLine: IPriceLine | null = null;
  let liveLineOn: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null = null;
  const syncLiveLine = () => {
    const q = hub.liveGold;
    const want = q !== null && shown !== null && series !== null && shown.instrument === 'XAUUSD' && hub.replayTime === null && state.settings.liveGold;
    if (liveLine && (liveLineOn !== series || !want)) {
      if (liveLineOn === series && series) series.removePriceLine(liveLine);
      liveLine = null;
      liveLineOn = null;
    }
    if (!want || !series || !q) return;
    const options = { price: q.price, color: COLORS.gold, lineWidth: 1 as const, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `live · ${q.source.label}` };
    if (liveLine) liveLine.applyOptions(options);
    else {
      liveLine = series.createPriceLine(options);
      liveLineOn = series;
    }
  };
  const offLive = hub.onLive(syncLiveLine);

  let ticket = 0;
  const reload = async () => {
    if (!hub.ready) {
      footer.textContent = 'Loading data…';
      return;
    }
    const { instrument, timeframe } = state.settings;
    const mine = ++ticket;
    symbol.textContent = `${instrument.slice(0, 3)}/${instrument.slice(3)} · ${timeframe}`;
    symbol.classList.toggle('gold', instrument === 'XAUUSD');
    const data = await hub.getBars({ instrument, timeframe });
    if (mine !== ticket) return; // a newer request overtook this one
    if (data) show(data);
    else showEmpty(instrument, timeframe);
    syncLiveLine();
  };

  const offSettings = state.onSettings(() => void reload());
  const offData = hub.onChange(() => void reload());
  void reload();

  return {
    destroy() {
      ticket++;
      offSettings();
      offData();
      offLive();
      chart.remove();
    },
  };
};
