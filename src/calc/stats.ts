/** Small statistics helpers. Pure. */

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Pearson correlation of two equal-length lists. Null when there are fewer
 * than three points or either list does not vary (correlation is undefined).
 */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n !== y.length) throw new RangeError('lists must be the same length');
  if (n < 3) return null;
  const mx = mean(x)!;
  const my = mean(y)!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** Percentage change from `from` to `to`: 1.5 means +1.5%. */
export function percentChange(from: number, to: number): number {
  return (to / from - 1) * 100;
}
