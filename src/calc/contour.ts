/**
 * Contour lines of a grid of numbers (marching squares), used to draw the
 * weather map's isobars. Pure.
 */

export interface Grid {
  cols: number;
  rows: number;
  /** Row by row: values[row * cols + col]. */
  values: Float32Array | number[];
}

/**
 * Line segments where the grid crosses `level`, as flat
 * [x1, y1, x2, y2, ...] in grid units (column, row), with positions
 * interpolated between grid points.
 */
export function contourSegments(grid: Grid, level: number): number[] {
  const { cols, rows, values } = grid;
  const out: number[] = [];
  const v = (c: number, r: number) => values[r * cols + c]!;
  // Fraction of the way from a to b at which the level is crossed.
  const t = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = v(c, r);
      const tr = v(c + 1, r);
      const br = v(c + 1, r + 1);
      const bl = v(c, r + 1);
      const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // Crossing points on the four edges of the cell.
      const top = [c + t(tl, tr), r] as const;
      const right = [c + 1, r + t(tr, br)] as const;
      const bottom = [c + t(bl, br), r + 1] as const;
      const left = [c, r + t(tl, bl)] as const;
      const line = (a: readonly [number, number], b: readonly [number, number]) => out.push(a[0], a[1], b[0], b[1]);
      switch (code) {
        case 1: case 14: line(left, bottom); break;
        case 2: case 13: line(bottom, right); break;
        case 3: case 12: line(left, right); break;
        case 4: case 11: line(top, right); break;
        case 6: case 9: line(top, bottom); break;
        case 7: case 8: line(left, top); break;
        case 5: case 10: {
          // Saddle: the cell centre decides which corners are joined.
          const centreHigh = (tl + tr + br + bl) / 4 >= level;
          if ((code === 5) === centreHigh) { line(left, top); line(bottom, right); }
          else { line(left, bottom); line(top, right); }
          break;
        }
      }
    }
  }
  return out;
}
