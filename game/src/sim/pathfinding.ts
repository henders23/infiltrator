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
