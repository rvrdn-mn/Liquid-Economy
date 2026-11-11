// Builds the weather map's outlines from Natural Earth data (public domain),
// as packaged by the world-atlas npm module.
//
//   npm run map:build
//
// Output: src/panels/weather/mapData.json, with every ring as a flat
// [lon, lat, lon, lat, ...] list rounded to a tenth of a degree. The app
// ships that file only; world-atlas and topojson-client are build-time tools.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const world = JSON.parse(await readFile(require.resolve('world-atlas/countries-110m.json'), 'utf8'));

// ISO 3166-1 numeric codes of the countries that use each currency.
const REGIONS = {
  USD: ['840'],
  CAD: ['124'],
  GBP: ['826'],
  JPY: ['392'],
  CHF: ['756'],
  AUD: ['036'],
  NZD: ['554'],
  // Euro area: AT BE BG HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES
  EUR: ['040', '056', '100', '191', '196', '233', '246', '250', '276', '300', '372', '380', '428', '440', '442', '470', '528', '620', '703', '705', '724'],
};

const round = (n) => Math.round(n * 10) / 10;

/** Outer rings of a GeoJSON geometry as flat coordinate lists. Holes are dropped: lakes do not matter at this scale. */
function rings(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((polygon) => {
    const flat = [];
    for (const [lon, lat] of polygon[0]) {
      const x = round(lon);
      const y = round(lat);
      const n = flat.length;
      if (n >= 2 && flat[n - 2] === x && flat[n - 1] === y) continue; // rounding made a duplicate
      flat.push(x, y);
    }
    return flat;
  });
}

const bounds = (ring) => {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minLon = Math.min(minLon, ring[i]); maxLon = Math.max(maxLon, ring[i]);
    minLat = Math.min(minLat, ring[i + 1]); maxLat = Math.max(maxLat, ring[i + 1]);
  }
  return { minLon, maxLon, minLat, maxLat };
};

const landObject = feature(world, world.objects.land);
const land = (landObject.features ?? [landObject])
  .flatMap((f) => rings(f.geometry))
  .filter((ring) => ring.length >= 8)
  .filter((ring) => bounds(ring).maxLat > -60); // leave Antarctica off the map

const countries = feature(world, world.objects.countries).features;
const regions = {};
const missing = [];
for (const [currency, ids] of Object.entries(REGIONS)) {
  regions[currency] = [];
  for (const id of ids) {
    const country = countries.find((c) => c.id === id);
    if (!country) {
      missing.push(`${currency}:${id}`); // too small for this scale, e.g. Malta
      continue;
    }
    let found = rings(country.geometry).filter((ring) => ring.length >= 8);
    // Keep the euro area to Europe: France's outline includes French Guiana.
    if (currency === 'EUR') found = found.filter((ring) => { const b = bounds(ring); return b.minLon > -15 && b.maxLon < 42 && b.minLat > 33; });
    regions[currency].push(...found);
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panels', 'weather', 'mapData.json');
await writeFile(out, JSON.stringify({ source: 'Natural Earth 1:110m, via world-atlas', land, regions }) + '\n');
const points = (list) => list.reduce((n, r) => n + r.length / 2, 0);
console.log(`land: ${land.length} rings, ${points(land)} points`);
for (const [c, r] of Object.entries(regions)) console.log(`${c}: ${r.length} rings, ${points(r)} points`);
if (missing.length) console.log('not in the 1:110m data:', missing.join(', '));
