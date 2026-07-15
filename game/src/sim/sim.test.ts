import { describe, expect, it } from 'vitest';
import { findPath, segmentClear, smoothPath } from './pathfinding';
import { gridFromAscii, WALL } from './grid';
import { makeRng } from './rng';
import { currentStep, moveOrder, moveStep } from './orders';
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

describe('free movement — segment clearance + string pulling', () => {
  const grid = gridFromAscii([
    '########',
    '#......#',
    '#.####.#',
    '#......#',
    '########',
  ]);
  it('sees straight lines in the open and rejects lines through walls', () => {
    expect(segmentClear(grid, { x: 1.5, y: 1.5 }, { x: 6.5, y: 1.5 })).toBe(true);
    expect(segmentClear(grid, { x: 1.5, y: 1.5 }, { x: 6.5, y: 3.5 })).toBe(false); // through the block
  });
  it('collapses a tile path to fluid legs ending at the exact goal point', () => {
    const goal = { x: 6.2, y: 3.7 }; // hugs the bottom wall — gets nudged to body clearance
    const tiles = findPath(grid, 1, 1, Math.floor(goal.x), Math.floor(goal.y))!;
    const pts = smoothPath(grid, { x: 1.5, y: 1.5 }, tiles, goal);
    expect(pts.length).toBeLessThan(tiles.length); // fewer legs than raw tile hops
    const end = pts[pts.length - 1];
    expect(Math.hypot(end.x - goal.x, end.y - goal.y)).toBeLessThan(0.4); // lands on the click, not a tile center
    // every leg is walkable as a straight line
    let prev = { x: 1.5, y: 1.5 };
    for (const p of pts) {
      expect(segmentClear(grid, prev, p)).toBe(true);
      prev = p;
    }
  });
});

describe('strafing — locked orientation while moving', () => {
  const openDeck = () => gridFromAscii(Array.from({ length: 6 }, () => '.'.repeat(12)));

  it('a strafe lock keeps the body facing while the unit travels', () => {
    const grid = openDeck();
    const u = makeUnit({ name: 'A', faction: 'friendly', pos: { x: 1.5, y: 1.5 }, speed: 4 });
    u.strafe = { x: 0, y: -1 }; // face "up" while moving right
    const world = new World(grid, [u], 1);
    u.order = { steps: [moveStep([{ x: 9.5, y: 1.5 }])], step: 0 };
    for (let i = 0; i < 30; i++) world.step(1 / 60);
    expect(u.pos.x).toBeGreaterThan(2); // moving…
    expect(u.facing).toEqual({ x: 0, y: -1 }); // …but still facing up
  });

  it('a facing waypoint flips the body once its distance is passed', () => {
    const grid = openDeck();
    const u = makeUnit({ name: 'A', faction: 'friendly', pos: { x: 1.5, y: 1.5 }, speed: 4 });
    const world = new World(grid, [u], 1);
    const step = moveStep([{ x: 9.5, y: 1.5 }]);
    step.facings.push({ at: 3, pos: { x: 4.5, y: 1.5 }, dir: { x: 0, y: 1 } });
    u.order = { steps: [step], step: 0 };

    for (let i = 0; i < 30; i++) world.step(1 / 60); // ~2 tiles in — before the waypoint
    expect(u.facing).toEqual({ x: 1, y: 0 }); // still facing travel
    for (let i = 0; i < 60; i++) world.step(1 / 60); // well past 3 tiles traveled
    expect(u.strafe).toEqual({ x: 0, y: 1 });
    expect(u.facing).toEqual({ x: 0, y: 1 }); // strafing from the waypoint on
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
