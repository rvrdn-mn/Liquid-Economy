/**
 * Cross rates from the two dollar pairs.
 *
 * EURGBP is EURUSD divided by GBPUSD; EURJPY is EURUSD times USDJPY. With
 * files for the seven dollar pairs, the other 21 pairs follow by arithmetic,
 * so the user does not have to download 28 files.
 *
 * Only the close of each bar is computed, on timestamps both legs have. A
 * cross's high and low cannot be known from its legs' highs and lows, so a
 * derived series is close-only and is always labelled as derived.
 */
import { FX_PAIRS, splitPair } from './instruments';
import type { Bar, BarRequest, BarSeries, InstrumentId } from './types';

export interface UsdLeg {
  instrument: InstrumentId;
  /** True for USDXXX pairs, where the currency's dollar value is 1 / price. */
  invert: boolean;
}

/** The dollar pair that prices a currency, and whether it must be inverted. */
export function usdLeg(currency: string): UsdLeg | null {
  if (currency === 'USD') return null;
  if (FX_PAIRS.includes(`${currency}USD`)) return { instrument: `${currency}USD`, invert: false };
  if (FX_PAIRS.includes(`USD${currency}`)) return { instrument: `USD${currency}`, invert: true };
  return null;
}

/** The two legs of a cross, or null for dollar pairs, gold and unknown symbols. */
export function crossLegs(pair: InstrumentId): { base: UsdLeg; quote: UsdLeg } | null {
  if (!FX_PAIRS.includes(pair)) return null;
  const { base, quote } = splitPair(pair);
  const b = usdLeg(base);
  const q = usdLeg(quote);
  return b && q ? { base: b, quote: q } : null;
}

const usdValue = (close: number, leg: UsdLeg) => (leg.invert ? 1 / close : close);

/** Close-only bars of a cross on the timestamps both legs share. */
export function deriveCrossBars(baseBars: readonly Bar[], base: UsdLeg, quoteBars: readonly Bar[], quote: UsdLeg): Bar[] {
  const out: Bar[] = [];
  let i = 0;
  let j = 0;
  while (i < baseBars.length && j < quoteBars.length) {
    const a = baseBars[i]!;
    const b = quoteBars[j]!;
    if (a.time < b.time) i++;
    else if (b.time < a.time) j++;
    else {
      const price = usdValue(a.close, base) / usdValue(b.close, quote);
      out.push({ time: a.time, open: price, high: price, low: price, close: price });
      i++;
      j++;
    }
  }
  return out;
}

interface Source {
  getBars(req: BarRequest): Promise<BarSeries | null>;
}

/**
 * A cross built from `source`'s two dollar legs, or null when the pair is
 * not a cross or either leg is missing. The same `from`/`to` go to both
 * legs, so a replay cut applies to the cross too.
 */
export async function getDerivedCross(source: Source, req: BarRequest): Promise<BarSeries | null> {
  const legs = crossLegs(req.instrument);
  if (!legs) return null;
  const [a, b] = await Promise.all([
    source.getBars({ ...req, instrument: legs.base.instrument }),
    source.getBars({ ...req, instrument: legs.quote.instrument }),
  ]);
  if (!a || !b) return null;
  const bars = deriveCrossBars(a.bars, legs.base, b.bars, legs.quote);
  if (bars.length === 0) return null;
  const replayAt = a.source.replayAt ?? b.source.replayAt;
  return {
    instrument: req.instrument,
    timeframe: req.timeframe,
    bars,
    source: {
      ...(replayAt !== undefined ? { replayAt } : {}),
      adapter: a.source.adapter,
      label: `Derived from ${legs.base.instrument} and ${legs.quote.instrument} files`,
      freshness: 'file',
      asOf: Math.min(a.source.asOf, b.source.asOf),
      retrievedAt: Math.max(a.source.retrievedAt, b.source.retrievedAt),
      closeOnly: true,
      note: 'The close of each bar is computed from the two dollar pairs. A cross has no knowable high or low from its legs.',
    },
  };
}
