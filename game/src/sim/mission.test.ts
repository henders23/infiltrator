// M5 slice — assault objective (channel a tile, then extract) + minimal hostile AI
// (rouse to noise, hunt, fall back). Pure-sim, deterministic.
import { describe, expect, it } from 'vitest';
import { gridFromAscii } from './grid';
import { moveOrder } from './orders';
import { findPath } from './pathfinding';
import { makeUnit } from './unit';
import { MissionGoal, World } from './world';

const openDeck = () => gridFromAscii(Array.from({ length: 10 }, () => '.'.repeat(20)));

// objective near the right, extraction a box on the left
const goal: MissionGoal = {
  objective: { x: 15, y: 5, radius: 2, channel: 2, label: 'BRIDGE' },
  extraction: { x: 1, y: 4, w: 3, h: 3, label: 'AIRLOCK' },
};

describe('assault objective', () => {
  it('secures the objective after channelling, then wins once the squad extracts', () => {
    const grid = openDeck();
    const f = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 15.5, y: 5.5 }, speed: 4 });
    const w = new World(grid, [f], 1, goal);

    expect(w.status).toBe('active');
    expect(w.objectiveSecured).toBe(false);

    // stand on the objective long enough to channel it
    for (let i = 0; i < 60 * 3; i++) w.step(1 / 60);
    expect(w.objectiveSecured).toBe(true);
    expect(w.status).toBe('active'); // secured, but not yet extracted

    // now walk into the extraction box
    f.order = moveOrder(findPath(grid, 15, 5, 2, 5)!);
    for (let i = 0; i < 60 * 12 && w.status === 'active'; i++) w.step(1 / 60);
    expect(w.status).toBe('won');
  });

  it('does not win by reaching extraction before the objective is secured', () => {
    const grid = openDeck();
    const f = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 15.5, y: 5.5 } });
    const w = new World(grid, [f], 1, goal);
    f.order = moveOrder(findPath(grid, 15, 5, 2, 5)!); // straight to extraction, skip the bridge
    for (let i = 0; i < 60 * 12; i++) w.step(1 / 60);
    expect(w.objectiveSecured).toBe(false);
    expect(w.status).toBe('active'); // standing in extraction means nothing until secured
  });

  it('loses when the whole squad is downed', () => {
    const grid = openDeck();
    const f = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 10.5, y: 5.5 }, hp: 1, armor: 0 });
    const h = makeUnit({ name: 'H', faction: 'hostile', pos: { x: 6.5, y: 5.5 }, weapon: 'carbine' });
    const w = new World(grid, [f, h], 42, goal);
    for (let i = 0; i < 60 * 20 && w.status === 'active'; i++) w.step(1 / 60);
    expect(w.status).toBe('lost');
  });

  it('stays deterministic with the mission layer active', () => {
    const run = () => {
      const grid = openDeck();
      const f = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 15.5, y: 5.5 }, speed: 3.7 });
      const w = new World(grid, [f], 7, goal);
      for (let i = 0; i < 200; i++) w.step(1 / 60);
      return { p: w.objectiveProgress, secured: w.objectiveSecured, status: w.status };
    };
    expect(run()).toEqual(run());
  });
});

describe('minimal hostile AI', () => {
  it('an idle hostile holds position until roused (stealth intact)', () => {
    const grid = openDeck();
    // friendly far away, out of sight-range — no engagement, no noise
    const h = makeUnit({ name: 'H', faction: 'hostile', pos: { x: 15.5, y: 5.5 }, weapon: 'pistol' });
    const start = { x: h.pos.x, y: h.pos.y };
    const w = new World(grid, [makeUnit({ name: 'F', faction: 'friendly', pos: { x: 1.5, y: 1.5 } }), h], 1, goal);
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    expect(h.combat).toBe('idle');
    expect(h.pos).toEqual(start); // never moved
  });

  it('a roused hostile with no shot advances on its last-known point', () => {
    const grid = openDeck();
    // a friendly too far to shoot at → the hostile has no target and must close on
    // the point it is investigating
    const far = makeUnit({ name: 'F', faction: 'friendly', pos: { x: 1.5, y: 1.5 } });
    const h = makeUnit({ name: 'H', faction: 'hostile', pos: { x: 15.5, y: 5.5 }, weapon: 'pistol' });
    h.combat = 'alert';
    h.investigate = { x: 4.5, y: 5.5 }; // heard something to the west
    const startX = h.pos.x;
    const w = new World(grid, [far, h], 1, goal);
    for (let i = 0; i < 60; i++) w.step(1 / 60);
    expect(h.pos.x).toBeLessThan(startX - 1); // advanced west toward it
  });

  it('gunfire rouses a hostile that cannot see the fight (noise carries through walls)', () => {
    // a wall band splits the deck; the firefight is above it, the sentry below — no LOS,
    // but the shots are within earshot, so the sentry wakes and leaves its post.
    const grid = gridFromAscii([
      '..............',
      '..............',
      '..............',
      '..............',
      '####..########', // wall band with a gap at x=4,5
      '..............',
      '..............',
      '..............',
    ]);
    const shooter = makeUnit({ name: 'S', faction: 'friendly', pos: { x: 9.5, y: 1.5 }, weapon: 'carbine' });
    const dummy = makeUnit({ name: 'D', faction: 'hostile', pos: { x: 9.5, y: 2.5 }, weapon: 'pistol', hp: 999, maxHp: 999, armor: 80 });
    const sentry = makeUnit({ name: 'H', faction: 'hostile', pos: { x: 9.5, y: 6.5 }, weapon: 'pistol' });
    const start = { x: sentry.pos.x, y: sentry.pos.y };
    const w = new World(grid, [shooter, dummy, sentry], 5, goal);
    for (let i = 0; i < 60 * 3; i++) w.step(1 / 60);
    expect(sentry.combat).not.toBe('idle'); // heard the gunfire
    expect(sentry.investigate).not.toBeNull();
    expect(Math.hypot(sentry.pos.x - start.x, sentry.pos.y - start.y)).toBeGreaterThan(0.5); // left its post
  });
});
