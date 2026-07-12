import { describe, expect, it } from 'vitest';
import { findPath } from './pathfinding';
import { gridFromAscii, WALL } from './grid';
import { makeRng } from './rng';
import { currentStep, moveOrder } from './orders';
import { makeUnit } from './unit';
import { World } from './world';

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(makeRng(43)()).not.toEqual(makeRng(42)());
  });
  it('stays within [0,1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('grid + ascii', () => {
  const grid = gridFromAscii([
    '#####', //
    '#..+#',
    '#.#.#',
    '#####',
  ]);
  it('parses walls, doors and floors', () => {
    expect(grid.get(0, 0)).toBe(WALL);
    expect(grid.isWalkable(3, 1)).toBe(true); // door
    expect(grid.isWalkable(2, 2)).toBe(false); // interior wall
    expect(grid.isWalkable(1, 1)).toBe(true); // floor
  });
  it('treats out-of-bounds as wall', () => {
    expect(grid.isWalkable(-1, 0)).toBe(false);
    expect(grid.isWalkable(99, 0)).toBe(false);
  });
});

describe('pathfinding', () => {
  const grid = gridFromAscii([
    '########',
    '#......#',
    '#.####.#',
    '#....#.#',
    '####.#.#',
    '#......#',
    '########',
  ]);
  it('routes around walls', () => {
    const path = findPath(grid, 1, 1, 6, 5);
    expect(path).not.toBeNull();
    // every step lands on a walkable tile
    for (const t of path!) expect(grid.isWalkable(t.x, t.y)).toBe(true);
    // path ends at the goal and excludes the start
    expect(path![path!.length - 1]).toEqual({ x: 6, y: 5 });
    expect(path![0]).not.toEqual({ x: 1, y: 1 });
  });
  it('returns null when the goal is unreachable', () => {
    const sealed = gridFromAscii(['#####', '#.#.#', '#####']);
    expect(findPath(sealed, 1, 1, 3, 1)).toBeNull();
  });
  it('does not cut through wall corners diagonally', () => {
    // moving from (1,1) to (2,2) diagonally is blocked by the corner walls
    const g = gridFromAscii(['####', '#.##', '##.#', '####']);
    expect(findPath(g, 1, 1, 2, 2)).toBeNull();
  });
});

describe('world — plan-then-execute movement', () => {
  const openDeck = () => gridFromAscii(Array.from({ length: 6 }, () => '.'.repeat(10)));

  it('advances a unit along its move order and completes it', () => {
    const grid = openDeck();
    const u = makeUnit({ name: 'A', faction: 'friendly', pos: { x: 1.5, y: 1.5 }, speed: 4 });
    const world = new World(grid, [u], 1);
    const path = findPath(grid, 1, 1, 5, 1)!;
    u.order = moveOrder(path);

    // paused semantics: stepping IS the execute — run enough fixed ticks to arrive
    for (let i = 0; i < 120; i++) world.step(1 / 60);

    expect(currentStep(u.order).kind).toBe('hold'); // completed plan becomes a standing hold
    expect(u.pos.x).toBeCloseTo(5.5, 3);
    expect(u.pos.y).toBeCloseTo(1.5, 3);
    expect(u.attention).toBe('path-complete');
    expect(world.events.some((e) => e.kind === 'path-complete')).toBe(true);
  });

  it('is deterministic: same orders + same ticks ⇒ same final position', () => {
    const run = () => {
      const grid = openDeck();
      const u = makeUnit({ name: 'A', faction: 'friendly', pos: { x: 1.5, y: 1.5 }, speed: 3.7 });
      const w = new World(grid, [u], 99);
      u.order = moveOrder(findPath(grid, 1, 1, 8, 4)!);
      for (let i = 0; i < 40; i++) w.step(1 / 60);
      const s = currentStep(u.order);
      return { x: u.pos.x, y: u.pos.y, idx: s.kind === 'move' ? s.index : -1 };
    };
    expect(run()).toEqual(run());
  });

  it('persists orders: an untouched unit keeps advancing while another holds', () => {
    const grid = openDeck();
    const mover = makeUnit({ name: 'M', faction: 'friendly', pos: { x: 1.5, y: 1.5 } });
    const holder = makeUnit({ name: 'H', faction: 'friendly', pos: { x: 1.5, y: 4.5 } });
    const world = new World(grid, [mover, holder], 1);
    mover.order = moveOrder(findPath(grid, 1, 1, 8, 1)!);
    // holder is left on its default HOLD — we never touch it

    for (let i = 0; i < 20; i++) world.step(1 / 60);
    expect(mover.pos.x).toBeGreaterThan(1.5); // moved
    expect(holder.pos).toEqual({ x: 1.5, y: 4.5 }); // untouched, held
  });

  it('reveals fog around friendlies but nothing starts fully known', () => {
    const grid = openDeck();
    const u = makeUnit({ name: 'A', faction: 'friendly', pos: { x: 1.5, y: 1.5 } });
    const world = new World(grid, [u], 1);
    expect(world.seen.has(grid.idx(1, 1))).toBe(true); // spawn tile revealed
    expect(world.seen.size).toBeLessThan(grid.width * grid.height); // not the whole deck
  });
});
