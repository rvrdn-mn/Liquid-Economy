/**
 * Near-live gold from gold-api.com (see docs/DATA_SOURCES.md for its terms).
 * One spot quote in US dollars per troy ounce. Their documentation asks
 * clients to wait 30 seconds between requests, which is the interval used.
 */
import type { Quote } from './types';

export const GOLD_API_URL = 'https://api.gold-api.com/price/XAU';
export const GOLD_POLL_SECONDS = 30;
/** After this long without a newer price the quote is called stale. */
export const GOLD_STALE_SECONDS = 150;

/**
 * Read the service's reply. Returns null unless it holds a positive price
 * and a readable update time: a quote without its age is not shown.
 */
export function parseGoldQuote(body: unknown, retrievedAt: number): Quote | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const price = b.price;
  const updated = typeof b.updatedAt === 'string' ? Date.parse(b.updatedAt) : NaN;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(updated)) return null;
  if (b.symbol !== undefined && b.symbol !== 'XAU') return null;
  if (b.currency !== undefined && b.currency !== 'USD') return null;
  const time = Math.floor(updated / 1000);
  return {
    instrument: 'XAUUSD',
    price,
    time,
    source: { adapter: 'gold-api', label: 'gold-api.com', freshness: 'near-live', asOf: time, retrievedAt },
  };
}
