// The deck-plan tilemap. Grid-first by design (BUILD_PLAN §2): detailed ship-plan
// art is a later render layer over exactly this grid, so the sim stays simple.

export const FLOOR = 0;
export const WALL = 1;
export const DOOR = 2;
/** Hard vacuum outside the hull — not walkable, holds no air, never fogged. */
export const SPACE = 3;
export type TileKind = typeof FLOOR | typeof WALL | typeof DOOR | typeof SPACE;

export interface Tile {
  x: number;
  y: number;
}

export class Grid {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;

  constructor(width: number, height: number, cells?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.cells = cells ?? new Uint8Array(width * height);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): TileKind {
    if (!this.inBounds(x, y)) return WALL;
    return this.cells[this.idx(x, y)] as TileKind;
  }

  set(x: number, y: number, kind: TileKind): void {
    if (this.inBounds(x, y)) this.cells[this.idx(x, y)] = kind;
  }

  isWall(x: number, y: number): boolean {
    return this.get(x, y) === WALL;
  }

  isSpace(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.get(x, y) === SPACE;
  }

  /** Floors and doors can be walked; walls, space, and out-of-bounds cannot. */
  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const k = this.get(x, y);
    return k !== WALL && k !== SPACE;
  }
}

/**
 * Build a grid from ASCII rows. Legible authored decks:
 *   '#' wall · '+' door · '.' floor · ' ' open space (vacuum outside the hull).
 * All rows are padded to the widest row (short rows become open floor).
 */
export function gridFromAscii(rows: string[]): Grid {
  const height = rows.length;
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const grid = new Grid(width, height);
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '.';
      grid.set(x, y, ch === '#' ? WALL : ch === '+' ? DOOR : ch === ' ' ? SPACE : FLOOR);
    }
  }
  return grid;
}
