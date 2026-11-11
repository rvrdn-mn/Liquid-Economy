// Builds the demo journal that ships with the app.
//
//   npm run samples:journal
//
// THE TRADES ARE INVENTED. Nobody placed them. They exist so the journal
// panel and the chart markers have something to show before you import
// your own history. Entry and exit prices are the sample set's daily
// reference rates for those dates; the times of day are illustrative.
// The same seed always produces the same file.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');

/** Small seeded random number generator, so the file is reproducible. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261110);
const pick = (list) => list[Math.floor(random() * list.length)];

async function load(symbol) {
  const text = await readFile(join(root, 'prices', `${symbol}_D1.csv`), 'utf8');
  return text.trim().split('\n').slice(1).map((line) => {
    const cells = line.split('\t');
    return { date: cells[0].replaceAll('.', '-'), price: Number(cells[4]) };
  });
}

// Units of the base currency in one lot, and how to turn a price move into US dollars.
const INSTRUMENTS = {
  XAUUSD: { lot: 100, toUsd: () => 1, volumes: [0.05, 0.1, 0.1, 0.2] },
  EURUSD: { lot: 100000, toUsd: () => 1, volumes: [0.1, 0.2, 0.3] },
  GBPUSD: { lot: 100000, toUsd: () => 1, volumes: [0.1, 0.2] },
  USDJPY: { lot: 100000, toUsd: (exit) => 1 / exit, volumes: [0.1, 0.2] },
};
const TIMES = ['01:30', '03:00', '07:15', '08:30', '12:45', '14:00', '16:30', '19:00'];
const SYMBOLS = ['XAUUSD', 'XAUUSD', 'XAUUSD', 'EURUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];

const data = Object.fromEntries(await Promise.all(Object.keys(INSTRUMENTS).map(async (s) => [s, await load(s)])));
const rows = [];
const days = data.XAUUSD.length;
for (let n = 0; n < 36; n++) {
  const symbol = pick(SYMBOLS);
  const spec = INSTRUMENTS[symbol];
  const series = data[symbol];
  const open = days - 130 + Math.floor(random() * 120);
  const close = Math.min(days - 1, open + 1 + Math.floor(random() * 6));
  const side = random() < 0.5 ? 'buy' : 'sell';
  const volume = pick(spec.volumes);
  const entry = series[open].price;
  const exit = series[close].price;
  const move = (exit - entry) * (side === 'buy' ? 1 : -1);
  const profit = move * volume * spec.lot * spec.toUsd(exit);
  rows.push({
    symbol,
    side,
    volume,
    openTime: `${series[open].date} ${pick(TIMES)}`,
    entry,
    closeTime: `${series[close].date} ${pick(TIMES)}`,
    exit,
    commission: -(volume * 7).toFixed(2),
    profit: profit.toFixed(2),
  });
}
rows.sort((a, b) => a.openTime.localeCompare(b.openTime));
const header = 'id,symbol,type,volume,open time,open price,close time,close price,commission,swap,profit';
const lines = rows.map((r, i) => [`D${i + 1}`, r.symbol, r.side, r.volume.toFixed(2), r.openTime, r.entry, r.closeTime, r.exit, r.commission.toFixed(2), '0.00', r.profit].join(','));
await mkdir(join(root, 'journal'), { recursive: true });
await writeFile(join(root, 'journal', 'demo-trades.csv'), [header, ...lines].join('\n') + '\n');
await writeFile(
  join(root, 'journal', 'manifest.json'),
  JSON.stringify(
    {
      path: 'demo-trades.csv',
      label: 'Demo journal',
      note: 'Invented example trades. Nobody placed them. Prices are the sample set\'s daily reference rates for those dates; times of day are illustrative. Import your own history to replace them.',
      utcOffsetMinutes: 0,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${rows.length} demo trades, ${rows[0].openTime} to ${rows.at(-1).closeTime}`);
