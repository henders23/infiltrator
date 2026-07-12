// M3 — doors, breach, grenades, overwatch, noise. Pure-sim, deterministic.
import { describe, expect, it } from 'vitest';
import { gridFromAscii } from './grid';
import { hasLineOfSight } from './los';
import { BREACH_TIME, GRENADE_FUSE, moveOrder } from './orders';
import { findPath } from './pathfinding';
import { makeUnit } from './unit';
import { World } from './world';

// entry corridor '.' | wall '#' | door '+' — a soldier at left, a defender in the room
const roomDeck = () =>
  gridFromAscii([
    '##########',
    '#....#....#',
    '#....+....#',
    '#....#....#',
    '##########',
  ]);

describe('doors', () => {
  it('a closed door blocks line of sight until opened', () => {
    const grid = roomDeck();
    const w = new World(grid, [], 1);
    // (2,2) left of door at (5,2); (7,2) right of it
    expect(hasLineOfSight(grid, 2, 2, 7, 2, w.opaqueAt)).toBe(false);
    w.openDoors.add(grid.idx(5, 2));
    expect(hasLineOfSight(grid, 2, 2, 7, 2, w.opaqueAt)).toBe(true);
  });

  it('walking through a closed door opens it quietly (no alert)', () => {
    const grid = roomDeck();
    const mover = makeUnit({ name: 'M', faction: 'friendly', pos: { x: 2.5, y: 2.5 } });
    const guard = makeUnit({ name: 'G', faction: 'hostile', pos: { x: 7.5, y: 2.5 } });
    const w = new World(grid, [mover, guard], 1);
    mover.order = moveOrder(findPath(grid, 2, 2, 4, 2)!); // up to the door, not through
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    // guard hasn't been alerted by any noise (LOS still blocked / quiet)
    expect(guard.combat).toBe('idle');
  });
});

describe('breach', () => {
  it('opens the door, stuns the defender beyond, and makes noise', () => {
    const grid = roomDeck();
    const stacker = makeUnit({ name: 'B', faction: 'friendly', pos: { x: 4.5, y: 2.5 } });
    const guard = makeUnit({ name: 'G', faction: 'hostile', pos: { x: 6.5, y: 2.5 }, armor: 4 });
    const w = new World(grid, [stacker, guard], 1);
    stacker.order = { steps: [{ kind: 'breach', door: { x: 5, y: 2 }, timer: BREACH_TIME }, { kind: 'hold' }], step: 0 };
    for (let i = 0; i < 60; i++) w.step(1 / 60); // ~1s, enough to breach
    expect(w.openDoors.has(grid.idx(5, 2))).toBe(true);
    expect(guard.stunnedUntil).toBeGreaterThan(w.time); // stunned right now
    expect(w.events.some((e) => e.kind === 'breach')).toBe(true);
  });
});

describe('grenades', () => {
  it('flashbang stuns everyone in radius without dealing damage', () => {
    const grid = gridFromAscii(Array.from({ length: 6 }, () => '.'.repeat(10)));
    const thrower = makeUnit({ name: 'T', faction: 'friendly', pos: { x: 1.5, y: 2.5 }, weaponsFree: false });
    const guard = makeUnit({ name: 'G', faction: 'hostile', pos: { x: 5.5, y: 2.5 } });
    const w = new World(grid, [thrower, guard], 1);
    thrower.order = {
      steps: [{ kind: 'grenade', target: { x: 5, y: 2 }, gtype: 'flash', fuse: GRENADE_FUSE, thrown: false }, { kind: 'hold' }],
      step: 0,
    };
    for (let i = 0; i < 90; i++) w.step(1 / 60);
    expect(guard.stunnedUntil).toBeGreaterThan(w.time);
    expect(guard.hp).toBe(guard.maxHp); // flash does no damage (thrower on hold-fire)
    expect(w.events.some((e) => e.kind === 'grenade')).toBe(true);
  });

  it('frag damages units in radius', () => {
    const grid = gridFromAscii(Array.from({ length: 6 }, () => '.'.repeat(10)));
    const thrower = makeUnit({ name: 'T', faction: 'friendly', pos: { x: 1.5, y: 2.5 } });
    const guard = makeUnit({ name: 'G', faction: 'hostile', pos: { x: 5.5, y: 2.5 }, armor: 4 });
    const w = new World(grid, [thrower, guard], 1);
    thrower.order = {
      steps: [{ kind: 'grenade', target: { x: 5, y: 2 }, gtype: 'frag', fuse: GRENADE_FUSE, thrown: false }, { kind: 'hold' }],
      step: 0,
    };
    for (let i = 0; i < 90; i++) w.step(1 / 60);
    expect(guard.hp).toBeLessThan(guard.maxHp);
  });
});

describe('overwatch', () => {
  it('fires at a target inside its arc but not behind it', () => {
    const grid = gridFromAscii(Array.from({ length: 8 }, () => '.'.repeat(12)));
    // sample the (transient) shot buffer every tick — a shot lives only ~0.12s
    const firedFriendly = (enemyPos: { x: number; y: number }, owPos: { x: number; y: number }) => {
      const ow = makeUnit({ name: 'O', faction: 'friendly', pos: owPos });
      const enemy = makeUnit({ name: 'E', faction: 'hostile', pos: enemyPos });
      const w = new World(grid, [ow, enemy], 5);
      ow.order = { steps: [{ kind: 'overwatch', dir: { x: 1, y: 0 } }], step: 0 }; // watching east
      let fired = false;
      for (let i = 0; i < 60; i++) {
        w.step(1 / 60);
        if (w.shots.some((s) => s.faction === 'friendly')) fired = true;
      }
      return fired;
    };
    const inArc = () => firedFriendly({ x: 8.5, y: 3.5 }, { x: 2.5, y: 3.5 }); // enemy east, in arc
    const behindArc = () => firedFriendly({ x: 2.5, y: 3.5 }, { x: 8.5, y: 3.5 }); // enemy west, behind
    expect(inArc()).toBe(true);
    expect(behindArc()).toBe(false);
  });
});

describe('noise / stealth', () => {
  it('gunfire wakes an idle defender out of line of sight', () => {
    // L-shaped: shooter fires at one guard; a second guard around the corner hears it
    const grid = gridFromAscii([
      '##########',
      '#........#',
      '#..####..#',
      '#..#..#..#',
      '#..#..#..#',
      '##########',
    ]);
    const shooter = makeUnit({ name: 'S', faction: 'friendly', pos: { x: 1.5, y: 1.5 } });
    const seen = makeUnit({ name: 'A', faction: 'hostile', pos: { x: 7.5, y: 1.5 } });
    const hidden = makeUnit({ name: 'B', faction: 'hostile', pos: { x: 4.5, y: 4.5 } }); // boxed in, no LOS
    const w = new World(grid, [shooter, seen, hidden], 1);
    expect(hasLineOfSight(grid, 1, 1, 4, 4, w.opaqueAt)).toBe(false); // truly hidden
    for (let i = 0; i < 60; i++) w.step(1 / 60);
    expect(hidden.combat).not.toBe('idle'); // heard the gunfire
  });
});
