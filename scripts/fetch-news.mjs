// Copies the latest press-release headlines from central banks whose own
// terms allow it into public/news/headlines.json.
//
//   npm run news:fetch          (behind a proxy: NODE_USE_ENV_PROXY=1)
//
// Only the headline, its date and a link back to the bank are stored: no
// article text. Each bank is named as the source in the app. A bank is on
// this list only if its terms were read and permit this; see
// docs/DATA_SOURCES.md. Needs Node 22.18 or later (it imports a .ts file).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed } from '../src/data/rss.ts';

const SOURCES = [
  { id: 'fed', name: 'Federal Reserve Board', currency: 'USD', host: 'federalreserve.gov', feed: 'https://www.federalreserve.gov/feeds/press_all.xml', terms: 'Public domain; cite the Board as the source.' },
  { id: 'ecb', name: 'European Central Bank', currency: 'EUR', host: 'ecb.europa.eu', feed: 'https://www.ecb.europa.eu/rss/press.html', terms: 'Free use; must be accurate and cite the ECB as the source.' },
  { id: 'snb', name: 'Swiss National Bank', currency: 'CHF', host: 'snb.ch', feed: 'https://www.snb.ch/public/en/rss/pressrel', terms: 'Use for non-commercial purposes, with reference to the source.' },
  { id: 'rba', name: 'Reserve Bank of Australia', currency: 'AUD', host: 'rba.gov.au', feed: 'https://www.rba.gov.au/rss/rss-cb-media-releases.xml', terms: 'Creative Commons Attribution 4.0 International.' },
  { id: 'boc', name: 'Bank of Canada', currency: 'CAD', host: 'bankofcanada.ca', feed: 'https://www.bankofcanada.ca/content_type/press-releases/feed/', terms: 'Free use with attribution to the Bank of Canada.' },
];
const PER_SOURCE = 12;

const items = [];
const sources = [];
for (const s of SOURCES) {
  try {
    const res = await fetch(s.feed, { headers: { 'user-agent': 'headline-reader (static site build)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const found = parseFeed(await res.text(), s.host).filter((i) => i.time !== null).slice(0, PER_SOURCE);
    for (const i of found) items.push({ source: s.id, currency: s.currency, title: i.title, link: i.link, time: i.time });
    sources.push({ id: s.id, name: s.name, currency: s.currency, site: `https://www.${s.host}/`, terms: s.terms, count: found.length });
    console.log(`${s.name}: ${found.length} headlines`);
  } catch (err) {
    // A bank that cannot be reached is listed with no headlines; nothing is made up for it.
    sources.push({ id: s.id, name: s.name, currency: s.currency, site: `https://www.${s.host}/`, terms: s.terms, count: 0, error: String(err.message ?? err) });
    console.log(`${s.name}: failed (${err.message ?? err})`);
  }
}
items.sort((a, b) => b.time - a.time);
if (items.length === 0) throw new Error('No headlines could be fetched; keeping the existing file.');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'news');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'headlines.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), sources, items }, null, 1) + '\n');
console.log(`${items.length} headlines written`);
