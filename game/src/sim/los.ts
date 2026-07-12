// Grid line-of-sight. Walls block sight; floors and doors are transparent (door
// open/close arrives in M3). Endpoints are excluded so a shooter standing against a
// wall can still see out of its own tile.

import { Grid } from './grid';

export function hasLineOfSight(grid: Grid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  // walk the line; any wall strictly between the endpoints blocks sight
  for (let guard = 0; guard < 1000; guard++) {
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) return true;
    if (grid.isWall(x, y)) return false;
  }
  return false;
}

/** Chebyshev tile distance between two tile-space points. */
export function tileDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}
