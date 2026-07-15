// A* over the deck grid. 8-directional, but diagonals may not cut through wall
// corners (you can't slip between two bulkheads). Returns the path EXCLUDING the
// start tile, or null if unreachable.

import { Grid, Tile } from './grid';

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  // 1.41421356 ≈ √2 for diagonal steps
  return dx + dy + (1.41421356 - 2) * Math.min(dx, dy);
}

export function findPath(grid: Grid, sx: number, sy: number, gx: number, gy: number): Tile[] | null {
  if (!grid.isWalkable(gx, gy) || !grid.inBounds(sx, sy)) return null;
  if (sx === gx && sy === gy) return [];

  const open: Node[] = [];
  const openBest = new Map<number, number>(); // idx -> best g seen
  const closed = new Set<number>();
  const start: Node = { x: sx, y: sy, g: 0, f: octile(sx, sy, gx, gy), parent: null };
  open.push(start);
  openBest.set(grid.idx(sx, sy), 0);

  while (open.length > 0) {
    // pop lowest f (linear scan — fine at deck scale; swap for a heap if maps grow)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ci = grid.idx(cur.x, cur.y);
    if (cur.x === gx && cur.y === gy) return reconstruct(cur);
    if (closed.has(ci)) continue;
    closed.add(ci);

    for (const [dx, dy] of STEPS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!grid.isWalkable(nx, ny)) continue;
      // no corner-cutting on diagonals
      if (dx !== 0 && dy !== 0) {
        if (!grid.isWalkable(cur.x + dx, cur.y) || !grid.isWalkable(cur.x, cur.y + dy)) continue;
      }
      const ni = grid.idx(nx, ny);
      if (closed.has(ni)) continue;
      const stepCost = dx !== 0 && dy !== 0 ? 1.41421356 : 1;
      const g = cur.g + stepCost;
      const prevBest = openBest.get(ni);
      if (prevBest !== undefined && prevBest <= g) continue;
      openBest.set(ni, g);
      open.push({ x: nx, y: ny, g, f: g + octile(nx, ny, gx, gy), parent: cur });
    }
  }
  return null;
}

function reconstruct(node: Node): Tile[] {
  const path: Tile[] = [];
  let n: Node | null = node;
  while (n && n.parent) {
    path.push({ x: n.x, y: n.y });
    n = n.parent;
  }
  path.reverse();
  return path;
}

// ── free (continuous) movement ────────────────────────────────────────────────
// A* stays the router, but soldiers no longer walk tile-center to tile-center:
// the tile path is string-pulled into the fewest straight legs that keep a body-
// radius clearance from walls, and the last leg ends at the exact clicked point.

export type Point = { x: number; y: number };

const BODY_RADIUS = 0.3; // clearance (in tiles) kept from walls while cutting corners
const SAMPLE_STEP = 0.12; // walkability sampling interval along a candidate segment

/** True when a straight walk from `a` to `b` stays clear of walls (with clearance). */
export function segmentClear(grid: Grid, a: Point, b: Point, radius = BODY_RADIUS): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / SAMPLE_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    // the body is a disc: probe its center and the four diagonal extremes so a
    // segment can't shave through a wall corner
    for (const [ox, oy] of [[0, 0], [radius, radius], [radius, -radius], [-radius, radius], [-radius, -radius]] as const) {
      if (!grid.isWalkable(Math.floor(px + ox), Math.floor(py + oy))) return false;
    }
  }
  return true;
}

/** Nudge a point so the body disc clears any wall bordering its tile. */
export function clampToWalkable(grid: Grid, p: Point, margin = BODY_RADIUS + 0.05): Point {
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  let x = p.x;
  let y = p.y;
  if (!grid.isWalkable(tx + 1, ty)) x = Math.min(x, tx + 1 - margin);
  if (!grid.isWalkable(tx - 1, ty)) x = Math.max(x, tx + margin);
  if (!grid.isWalkable(tx, ty + 1)) y = Math.min(y, ty + 1 - margin);
  if (!grid.isWalkable(tx, ty - 1)) y = Math.max(y, ty + margin);
  return { x, y };
}

/**
 * Collapse a tile path into fluid straight legs (greedy string pulling), from the
 * unit's exact position to the exact goal point (nudged clear of walls). Returns
 * at least one point.
 */
export function smoothPath(grid: Grid, start: Point, tiles: Tile[], goal: Point): Point[] {
  const g = clampToWalkable(grid, goal);
  const pts: Point[] = tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 }));
  if (pts.length) pts[pts.length - 1] = g;
  else pts.push(g);

  const out: Point[] = [];
  let anchor = start;
  let i = 0;
  while (i < pts.length) {
    // reach as far ahead as a clear straight line allows
    let j = i;
    for (let k = pts.length - 1; k > i; k--) {
      if (segmentClear(grid, anchor, pts[k])) {
        j = k;
        break;
      }
    }
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  return out;
}
