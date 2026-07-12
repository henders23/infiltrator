// The deterministic tactical world. `step(dt)` advances one FIXED tick — no
// rendering, no DOM, no wall-clock, no Math.random. Everything the player sees is
// derived from this state; everything they do becomes an Order consumed here.

import { Grid } from './grid';
import { isOrderComplete } from './orders';
import { makeRng, Rng } from './rng';
import { Unit } from './unit';

export interface WorldEvent {
  time: number;
  kind: 'path-complete' | 'contact' | 'info';
  text: string;
}

/** How far a friendly reveals fog (Chebyshev tiles). Stub reveal — LOS lands in M2. */
export const REVEAL_RADIUS = 6;
const ARRIVE_EPS = 0.02;

export class World {
  readonly grid: Grid;
  readonly units: Unit[];
  readonly rng: Rng;
  time = 0;
  /** Tile indices ever revealed by a friendly. Fog-of-war stub. */
  readonly seen = new Set<number>();
  /** Append-only event log drained by the UI. */
  readonly events: WorldEvent[] = [];

  constructor(grid: Grid, units: Unit[], seed = 1) {
    this.grid = grid;
    this.units = units;
    this.rng = makeRng(seed);
    this.revealFog();
  }

  unit(id: number): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  step(dt: number): void {
    this.time += dt;
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.faction === 'friendly') this.advance(u, dt);
    }
    this.revealFog();
  }

  /** Advance one unit along its move order for `dt` seconds. */
  private advance(u: Unit, dt: number): void {
    if (u.order.kind !== 'move') return;
    let budget = u.speed * dt; // tiles we may travel this tick
    while (budget > 0 && u.order.index < u.order.path.length) {
      const node = u.order.path[u.order.index];
      // target the tile centre
      const tx = node.x + 0.5;
      const ty = node.y + 0.5;
      const dx = tx - u.pos.x;
      const dy = ty - u.pos.y;
      const d = Math.hypot(dx, dy);
      if (d <= ARRIVE_EPS) {
        u.pos.x = tx;
        u.pos.y = ty;
        u.order.index++;
        continue;
      }
      u.facing.x = dx / d;
      u.facing.y = dy / d;
      const stepDist = Math.min(budget, d);
      u.pos.x += (dx / d) * stepDist;
      u.pos.y += (dy / d) * stepDist;
      budget -= stepDist;
      if (d - stepDist <= ARRIVE_EPS) {
        u.pos.x = tx;
        u.pos.y = ty;
        u.order.index++;
      }
    }
    if (isOrderComplete(u.order)) {
      u.attention = 'path-complete';
      this.events.push({
        time: this.time,
        kind: 'path-complete',
        text: `${u.name} reached the objective.`,
      });
      // becomes a standing hold — position/facing preserved until re-tasked
      u.order = { kind: 'hold' };
    }
  }

  private revealFog(): void {
    for (const u of this.units) {
      if (!u.alive || u.faction !== 'friendly') continue;
      const cx = Math.floor(u.pos.x);
      const cy = Math.floor(u.pos.y);
      for (let y = cy - REVEAL_RADIUS; y <= cy + REVEAL_RADIUS; y++) {
        for (let x = cx - REVEAL_RADIUS; x <= cx + REVEAL_RADIUS; x++) {
          if (this.grid.inBounds(x, y)) this.seen.add(this.grid.idx(x, y));
        }
      }
    }
  }
}
