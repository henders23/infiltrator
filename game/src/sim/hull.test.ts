// M4 — hull breaches, pressure, decompression. Pure-sim, deterministic.
import { describe, expect, it } from 'vitest';
import { gridFromAscii } from './grid';
import { makeUnit } from './unit';
import { World } from './world';

// two rooms split by a wall with a door; the outer ring is the hull
const twoRoomShip = () =>
  gridFromAscii([
    '###########',
    '#....#....#',
    '#....+....#',
    '#....#....#',
    '###########',
  ]);

const settle = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) w.step(1 / 60);
};

describe('hull walls', () => {
  it('classifies exterior walls as hull and interior bulkheads as not', () => {
    const w = new World(twoRoomShip(), [], 1);
    expect(w.isHullWall(3, 0)).toBe(true); // top border
    expect(w.isHullWall(0, 2)).toBe(true); // left border
    expect(w.isHullWall(5, 1)).toBe(false); // interior divider wall
    expect(w.isHullWall(2, 2)).toBe(false); // floor is not a wall
  });
});

describe('decompression', () => {
  it('a hull breach depressurizes its compartment but a sealed room stays pressurized', () => {
    const grid = twoRoomShip();
    const w = new World(grid, [], 1);
    w.breaches.add(grid.idx(2, 0)); // blow the left room's top hull
    settle(w, 4);
    expect(w.pressureAt(2, 2)).toBeLessThan(0.2); // left room vented
    expect(w.pressureAt(8, 2)).toBeGreaterThan(0.9); // right room sealed by the closed door
  });

  it('opening the door lets the vacuum spread into the next room', () => {
    const grid = twoRoomShip();
    const w = new World(grid, [], 1);
    w.breaches.add(grid.idx(2, 0));
    settle(w, 4);
    expect(w.pressureAt(8, 2)).toBeGreaterThan(0.9);
    w.openDoors.add(grid.idx(5, 2)); // door opens — the breach now reaches the right room
    settle(w, 6);
    // air bleeds out through the doorway — the once-sealed room is now depressurizing
    expect(w.pressureAt(8, 2)).toBeLessThan(0.7);
  });

  it('kills an unsuited soldier in a venting room but a suited one survives', () => {
    const grid = twoRoomShip();
    const bare = makeUnit({ name: 'BARE', faction: 'friendly', pos: { x: 3.5, y: 2.5 } });
    const eva = makeUnit({ name: 'EVA', faction: 'friendly', pos: { x: 2.5, y: 3.5 }, suit: true });
    const w = new World(grid, [bare, eva], 1);
    w.breaches.add(grid.idx(2, 0));
    settle(w, 6);
    expect(bare.alive).toBe(false);
    expect(eva.alive).toBe(true);
    expect(w.events.some((e) => e.kind === 'kill')).toBe(true);
  });

  it('spares a soldier safely behind a closed door from the breach next door', () => {
    const grid = twoRoomShip();
    const safe = makeUnit({ name: 'SAFE', faction: 'friendly', pos: { x: 8.5, y: 2.5 } });
    const w = new World(grid, [safe], 1);
    w.breaches.add(grid.idx(2, 0)); // breach in the LEFT room; safe is in the right, door closed
    settle(w, 6);
    expect(safe.alive).toBe(true);
    expect(safe.hp).toBe(safe.maxHp);
  });

  it('a hull-charge order step opens a breach that vents the room', () => {
    const grid = twoRoomShip();
    const sapper = makeUnit({ name: 'S', faction: 'friendly', pos: { x: 2.5, y: 1.5 }, suit: true });
    const w = new World(grid, [sapper], 1);
    sapper.order = { steps: [{ kind: 'hullcharge', wall: { x: 2, y: 0 }, timer: 1.0 }, { kind: 'hold' }], step: 0 };
    settle(w, 2);
    expect(w.breaches.has(grid.idx(2, 0))).toBe(true);
    settle(w, 3);
    expect(w.pressureAt(3, 2)).toBeLessThan(0.3);
    expect(w.events.some((e) => e.kind === 'breach' && /venting/.test(e.text))).toBe(true);
  });
});
