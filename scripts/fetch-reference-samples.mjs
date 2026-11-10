// Regenerates public/samples from Frankfurter daily reference rates.
//
//   npm run samples:fetch                 (last 12 months up to yesterday)
//   npm run samples:fetch -- 2025-11-03 2026-11-09
//
// Every number written is a rate published by api.frankfurter.dev (blended
// central-bank reference rates). Nothing is interpolated: each daily row has
// open = high = low = close = that day's rate, and Saturdays and Sundays are
// left out. Files use the MetaTrader 5 daily "Export Bars" layout so they go
// through the same import path as a user's own exports.
//
// Behind a proxy, run with NODE_USE_ENV_PROXY=1.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORDER = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
const API = 'https://api.frankfurter.dev/v2/rates';
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');

const iso = (d) => d.toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400_000);
const yearAgo = new Date(yesterday.getTime() - 365 * 86400_000);
const from = process.argv[2] ?? iso(yearAgo);
const to = process.argv[3] ?? iso(yesterday);

async function fetchRates(base, quotes) {
  const url = `${API}?from=${from}&to=${to}&base=${base}&quotes=${quotes.join(',')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const isWeekend = (date) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

function toMt5Daily(rows) {
  const lines = ['<DATE>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>'];
  for (const { date, rate } of rows) {
    const d = date.replaceAll('-', '.');
    lines.push([d, rate, rate, rate, rate, 0, 0, 0].join('\t'));
  }
  return lines.join('\n') + '\n';
}

const series = new Map(); // instrument -> [{date, rate}]
const add = (rows) => {
  for (const r of rows) {
    if (isWeekend(r.date) || !(r.rate > 0)) continue;
    const id = `${r.base}${r.quote}`;
    if (!series.has(id)) series.set(id, []);
    series.get(id).push({ date: r.date, rate: r.rate });
  }
};

add(await fetchRates('XAU', ['USD']));
for (let i = 0; i < ORDER.length - 1; i++) {
  add(await fetchRates(ORDER[i], ORDER.slice(i + 1)));
}

await mkdir(join(outDir, 'prices'), { recursive: true });
const files = [];
for (const [instrument, rows] of series) {
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const path = `prices/${instrument}_D1.csv`;
  await writeFile(join(outDir, path), toMt5Daily(rows));
  files.push({ path, instrument, timeframe: 'D1' });
  console.log(`${instrument}: ${rows.length} days, ${rows[0].date} to ${rows.at(-1).date}`);
}

const manifest = {
  description:
    'Daily reference rates, one observation per day (open = high = low = close). Not intraday market prices: no daily range, weekends omitted.',
  source: 'Frankfurter blended central-bank reference rates',
  sourceUrl: 'https://frankfurter.dev',
  licenceNote:
    'Frankfurter states its blended rates are its own calculation and free to use, including commercially, and that storing daily observations is encouraged.',
  retrievedAt: new Date().toISOString(),
  from,
  to,
  closeOnly: true,
  utcOffsetMinutes: 0,
  files,
};
await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${files.length} files and manifest.json to ${outDir}`);
