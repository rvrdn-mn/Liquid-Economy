// Saves a snapshot of the US 10-year Treasury yield so the gold drivers
// work with no network. The app still asks the Treasury for fresh data
// when it starts, and falls back to this file if that fails.
//
//   npm run samples:yield          (behind a proxy: NODE_USE_ENV_PROXY=1)
//
// Every number is as published in the Treasury's daily par yield curve
// file. US federal government data; nothing is filled in.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = (year) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

const thisYear = new Date().getUTCFullYear();
const rows = new Map();
for (const year of [thisYear - 1, thisYear]) {
  const res = await fetch(url(year));
  if (!res.ok) throw new Error(`Treasury ${year}: HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/);
  const header = lines[0].split(',').map((c) => c.replaceAll('"', '').trim());
  const col = header.indexOf('10 Yr');
  if (col === -1) throw new Error('No "10 Yr" column in the Treasury file');
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const [m, d, y] = cells[0].split('/');
    const value = cells[col];
    if (!y || value === undefined || value.trim() === '' || !Number.isFinite(Number(value))) continue;
    rows.set(`${y}-${m}-${d}`, value.trim());
  }
}
const sorted = [...rows].sort(([a], [b]) => a.localeCompare(b));
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples', 'drivers');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'us10y.csv'), 'date,value\n' + sorted.map(([d, v]) => `${d},${v}`).join('\n') + '\n');
await writeFile(
  join(outDir, 'manifest.json'),
  JSON.stringify(
    {
      yield: {
        path: 'us10y.csv',
        label: 'US 10-year yield',
        source: 'US Treasury daily par yield curve (saved copy)',
        sourceUrl: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve',
        retrievedAt: new Date().toISOString(),
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(`${sorted.length} days, ${sorted[0][0]} to ${sorted.at(-1)[0]}, last value ${sorted.at(-1)[1]}`);
