/** Map geometry for the weather view: projection and where each currency's weather sits. Pure. */
import type { Currency } from '../../data/types';

/** The map shows longitudes LON_MIN .. LON_MIN + 360, so the Pacific is split east of New Zealand. */
export const LON_MIN = -170;
export const LAT_MAX = 80;
export const LAT_MIN = -58;
/** Width divided by height of the map (a plain lat/long grid). */
export const MAP_ASPECT = 360 / (LAT_MAX - LAT_MIN);

/** Longitude/latitude to 0..1 across and down the map. */
export function project(lon: number, lat: number): [number, number] {
  const wrapped = lon < LON_MIN ? lon + 360 : lon;
  return [(wrapped - LON_MIN) / 360, (LAT_MAX - lat) / (LAT_MAX - LAT_MIN)];
}

export interface Station {
  /** Centre of the currency's weather system. */
  lon: number;
  lat: number;
  /** A point on the region itself; a leader line is drawn when it differs from the centre. */
  anchorLon: number;
  anchorLat: number;
  /** Which side of the centre the label sits on. */
  label: 'left' | 'right';
}

/**
 * Europe's three currencies sit within a few degrees of each other, so
 * their weather systems are spread out over the sea and the north, each
 * tied back to its region by a leader line.
 */
export const STATIONS: Record<Currency, Station> = {
  USD: { lon: -98, lat: 39, anchorLon: -98, anchorLat: 39, label: 'left' },
  CAD: { lon: -104, lat: 60, anchorLon: -104, anchorLat: 60, label: 'left' },
  GBP: { lon: -22, lat: 58, anchorLon: -2, anchorLat: 54, label: 'left' },
  EUR: { lon: 30, lat: 56, anchorLon: 10, anchorLat: 50, label: 'right' },
  CHF: { lon: 6, lat: 34, anchorLon: 8.2, anchorLat: 46.8, label: 'right' },
  JPY: { lon: 139, lat: 37, anchorLon: 139, anchorLat: 37, label: 'left' },
  AUD: { lon: 134, lat: -25, anchorLon: 134, anchorLat: -25, label: 'left' },
  NZD: { lon: 170, lat: -44, anchorLon: 172, anchorLat: -42, label: 'left' },
};

/** Spread of each weather system, as a fraction of the map's width. */
export const SIGMA = 0.07;

/**
 * Bell-shaped influence of a system centred at (cx, cy) on the point
 * (x, y). All four are 0..1 map positions; height is scaled so distance is
 * the same in both directions.
 */
export function influence(x: number, y: number, cx: number, cy: number): number {
  const dx = x - cx;
  const dy = (y - cy) / MAP_ASPECT;
  return Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
}
