import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../content/weapons';
import { coverMitigation } from './cover';
import { damageAfterArmor, hitChance, rangeFalloff } from './combat';
import { gridFromAscii } from './grid';
import { hasLineOfSight } from './los';
import { moveOrder } from './orders';
import { findPath } from './pathfinding';
import { makeUnit } from './unit';
import { World } from './world';

describe('line of sight', () => {
  const grid = gridFromAscii([
    '########',
    '#......#',
    '#..##..#',
    '#......#',
    '########',
  ]);
  it('sees across open floor', () => {
    expect(hasLineOfSight(grid, 1, 1, 6, 1)).toBe(true);
  });
  it('is blocked by a wall between', () => {
    expect(hasLineOfSight(grid, 1, 2, 6, 2)).toBe(false); // wall pillar at x=3,4
  });
});

describe('cover', () => {
  const grid = gridFromAscii(['#####', '#...#', '#...#', '#####']);
  it('gives cover when a wall sits between target and attacker', () => {
    // target at (1,1) hugging the left/top walls; attacker to the left → wall at (0,1)
    expect(coverMitigation(grid, 1, 1, -3, 1)).toBeGreaterThan(0);
  });
  it('gives no cover in the open', () => {
    expect(coverMitigation(grid, 2, 2, 3, 2)).toBe(0); // (3,2) is floor, open toward attacker
  });
});

describe('combat math', () => {
  const carbine = WEAPONS.carbine;
  it('range falloff drops past half range', () => {
    expect(rangeFalloff(carbine, 1)).toBe(1);
    expect(rangeFalloff(carbine, carbine.range)).toBeCloseTo(0.4, 5);
    expect(rangeFalloff(carbine, carbine.range * 0.75)).toBeLessThan(1);
  });
  it('hit chance is clamped and reduced by cover + suppression', () => {
    const open = hitChance(carbine, 1, 0, false);
    const covered = hitChance(carbine, 1, 0.4, false);
    const suppressed = hitChance(carbine, 1, 0, true);
    expect(covered).toBeLessThan(open);
    expect(suppressed).toBeLessThan(open);
    expect(hitChance(carbine, 1, 0, false)).toBeLessThanOrEqual(0.95);
    expect(hitChance(carbine, 999, 0.9, true)).toBeGreaterThanOrEqual(0.05);
  });
  it('armour reduces damage; penetration claws it back', () => {
    const lowArmor = damageAfterArmor(carbine, 4, 0.5);
    const highArmor = damageAfterArmor(carbine, 40, 0.5);
    expect(highArmor).toBeLessThan(lowArmor);
    expect(highArmor).toBeGreaterThanOrEqual(3); // damage floor
  });
});

describe('world combat', () => {
  const openDeck = () => gridFromAscii(Array.from({ length: 8 }, () => '.'.repeat(16)));

  it('a friendly in LOS kills a hostile, deterministically', () => {
    const runOnce = () => {
      const grid = openDeck();
      // SAW outranges the hostile's pistol, so this is a clean kill, not a coin-flip trade
      const f = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 2.5, y: 2.5 }, weapon: 'saw' });
      const h = makeUnit({ name: 'H', faction: 'hostile', pos: { x: 10.5, y: 2.5 }, weapon: 'pistol', armor: 6 });
      const w = new World(grid, [f, h], 1234);
      for (let i = 0; i < 60 * 12 && h.alive; i++) w.step(1 / 60);
      return { dead: !h.alive, kill: w.events.some((e) => e.kind === 'kill'), fUnhurt: f.hp === f.maxHp };
    };
    const a = runOnce();
    expect(a.dead).toBe(true);
    expect(a.kill).toBe(true);
    expect(a.fUnhurt).toBe(true); // hostile pistol never reached the friendly
    expect(runOnce()).toEqual(a); // same seed ⇒ same outcome
  });

  it('hostiles only engage after their reaction delay (not instantly)', () => {
    const grid = openDeck();
    const f = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 2.5, y: 2.5 } });
    const h = makeUnit({ name: 'H', faction: 'hostile', pos: { x: 6.5, y: 2.5 } });
    const w = new World(grid, [f, h], 7);
    w.step(1 / 60); // one tick: spotted, but still within reaction window
    expect(h.combat).toBe('alert');
    expect(w.shots.every((s) => s.faction !== 'hostile')).toBe(true);
  });

  it('suppression pins a moving friendly in place', () => {
    const grid = openDeck();
    const f = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 2.5, y: 4.5 }, weapon: 'pistol' });
    const h = makeUnit({ name: 'H', faction: 'hostile', pos: { x: 8.5, y: 4.5 }, weapon: 'carbine' });
    const w = new World(grid, [f, h], 3);
    f.order = moveOrder(findPath(grid, 2, 4, 2, 1)!); // try to move away, across the room
    let pinnedAtLeastOnce = false;
    for (let i = 0; i < 120; i++) {
      const before = f.pos.y;
      w.step(1 / 60);
      if (f.suppressedUntil > w.time - 1 && Math.abs(f.pos.y - before) < 1e-6 && f.alive && !f.downed) {
        pinnedAtLeastOnce = true;
      }
      if (!f.alive) break;
    }
    expect(f.stress).toBeGreaterThan(0);
    expect(pinnedAtLeastOnce).toBe(true);
  });

  it('a downed friendly bleeds out to K.I.A. if left', () => {
    const grid = openDeck();
    const f = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 2.5, y: 2.5 }, hp: 1, armor: 0 });
    const h = makeUnit({ name: 'H', faction: 'hostile', pos: { x: 5.5, y: 2.5 }, weapon: 'carbine' });
    const w = new World(grid, [f, h], 42);
    // run until F goes down
    for (let i = 0; i < 60 * 12 && !f.downed && f.alive; i++) w.step(1 / 60);
    expect(f.downed || !f.alive).toBe(true);
    // then long enough to bleed out
    for (let i = 0; i < 60 * 30 && f.alive; i++) w.step(1 / 60);
    expect(f.alive).toBe(false);
    expect(w.events.some((e) => e.text.includes('K.I.A.'))).toBe(true);
  });
});
