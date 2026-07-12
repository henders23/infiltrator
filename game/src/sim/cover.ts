// Directional cover. A target hugging a wall on the side an attacker is shooting
// from is harder to hit — this is what makes doorframes and corners matter and
// rewards positioning (DESIGN §4.3). Returns a hit-chance MITIGATION in 0..~0.55.

import { Grid } from './grid';

const HALF_COVER = 0.4;
const CORNER_COVER = 0.3;

export function coverMitigation(
  grid: Grid,
  tx: number,
  ty: number,
  ax: number,
  ay: number,
): number {
  const dirX = Math.sign(ax - tx);
  const dirY = Math.sign(ay - ty);
  let cover = 0;
  // wall directly between the target and the incoming direction, on each axis
  if (dirX !== 0 && grid.isWall(tx + dirX, ty)) cover = Math.max(cover, HALF_COVER);
  if (dirY !== 0 && grid.isWall(tx, ty + dirY)) cover = Math.max(cover, HALF_COVER);
  // a wall on the diagonal corner gives lighter cover
  if (dirX !== 0 && dirY !== 0 && grid.isWall(tx + dirX, ty + dirY)) {
    cover = Math.max(cover, CORNER_COVER);
  }
  return cover;
}
