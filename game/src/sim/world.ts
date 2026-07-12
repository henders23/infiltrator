// The deterministic tactical world. `step(dt)` advances one FIXED tick — no
// rendering, no DOM, no wall-clock, no Math.random. Everything the player sees is
// derived from this state; everything they do becomes an Order consumed here.
//
// M2 adds combat: units acquire targets in LOS + range and trade fire, cover and
// suppression shape the odds, and casualties bleed out. All rolls use the seeded RNG.

import { coverMitigation } from './cover';
import { damageAfterArmor, hitChance } from './combat';
import { Grid } from './grid';
import { hasLineOfSight, tileDist } from './los';
import { isOrderComplete } from './orders';
import { makeRng, Rng } from './rng';
import { isActive, Unit } from './unit';
import { weaponOf } from '../content/weapons';

export interface WorldEvent {
  time: number;
  kind: 'path-complete' | 'contact' | 'engage' | 'hit' | 'down' | 'kill' | 'info';
  text: string;
}

/** A resolved shot, kept briefly so the renderer can draw a tracer. */
export interface Shot {
  time: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  hit: boolean;
  faction: Unit['faction'];
}

export const REVEAL_RADIUS = 6;
const ARRIVE_EPS = 0.02;
const SUPPRESS_SECONDS = 1.4; // how long a shot pins/degrades the target
const STRESS_DECAY = 10; // stress points shed per second when not under fire
const BLEEDOUT_SECONDS = 22; // a downed friendly's clock (M7 adds stabilize/drag)
const AI_REACTION = 0.5; // hostile spot → engage delay
const SHOT_TTL = 0.12;
const ENGAGE_HYSTERESIS = 2.5; // hostile keeps looking this long after losing LOS

export class World {
  readonly grid: Grid;
  readonly units: Unit[];
  readonly rng: Rng;
  time = 0;
  readonly seen = new Set<number>();
  readonly events: WorldEvent[] = [];
  readonly shots: Shot[] = [];

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
      if (isActive(u) && u.faction === 'friendly') this.advance(u, dt);
    }
    this.updateAI(dt);
    this.runCombat(dt);
    this.decayAndBleed(dt);
    this.pruneShots();
    this.revealFog();
  }

  // ── movement ────────────────────────────────────────────────────────────────
  private advance(u: Unit, dt: number): void {
    if (u.order.kind !== 'move') return;
    // suppressed units are pinned — they keep their order but can't advance
    if (u.suppressedUntil > this.time) return;
    let budget = u.speed * dt;
    while (budget > 0 && u.order.index < u.order.path.length) {
      const node = u.order.path[u.order.index];
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
      u.order = { kind: 'hold' };
    }
  }

  // ── hostile AI ──────────────────────────────────────────────────────────────
  private updateAI(dt: number): void {
    for (const h of this.units) {
      if (!isActive(h) || h.faction !== 'hostile') continue;
      const target = this.nearestVisibleEnemy(h);
      switch (h.combat) {
        case 'idle':
          if (target) {
            h.combat = 'alert';
            h.combatTimer = AI_REACTION;
          }
          break;
        case 'alert':
          h.combatTimer -= dt;
          if (!target) {
            h.combat = 'idle';
          } else if (h.combatTimer <= 0) {
            h.combat = 'engage';
            h.combatTimer = ENGAGE_HYSTERESIS;
            this.events.push({ time: this.time, kind: 'engage', text: `${h.name} opens fire.` });
          }
          break;
        case 'engage':
          if (target) h.combatTimer = ENGAGE_HYSTERESIS;
          else {
            h.combatTimer -= dt;
            if (h.combatTimer <= 0) h.combat = 'idle';
          }
          break;
      }
    }
  }

  // ── combat ──────────────────────────────────────────────────────────────────
  private runCombat(dt: number): void {
    for (const u of this.units) {
      if (!isActive(u)) continue;
      u.fireCooldown = Math.max(0, u.fireCooldown - dt);
      // hostiles only shoot once engaged; friendlies are always weapons-free
      if (u.faction === 'hostile' && u.combat !== 'engage') continue;
      const target = this.nearestVisibleEnemy(u);
      u.targetId = target ? target.id : null;
      if (target && u.fireCooldown <= 0) {
        this.resolveShot(u, target);
        u.fireCooldown = weaponOf(u.weapon).fireInterval;
      }
    }
  }

  private resolveShot(shooter: Unit, target: Unit): void {
    const w = weaponOf(shooter.weapon);
    const dist = tileDist(shooter.pos.x, shooter.pos.y, target.pos.x, target.pos.y);
    const cover = coverMitigation(
      this.grid,
      Math.floor(target.pos.x),
      Math.floor(target.pos.y),
      Math.floor(shooter.pos.x),
      Math.floor(shooter.pos.y),
    );
    shooter.facing.x = (target.pos.x - shooter.pos.x) / (dist || 1);
    shooter.facing.y = (target.pos.y - shooter.pos.y) / (dist || 1);

    const chance = hitChance(w, dist, cover, shooter.suppressedUntil > this.time);
    const hit = this.rng() < chance;

    // being shot at suppresses and stresses the target whether or not it connects
    target.stress = Math.min(100, target.stress + w.suppression);
    target.suppressedUntil = Math.max(target.suppressedUntil, this.time + SUPPRESS_SECONDS);

    this.shots.push({
      time: this.time,
      from: { x: shooter.pos.x, y: shooter.pos.y },
      to: { x: target.pos.x, y: target.pos.y },
      hit,
      faction: shooter.faction,
    });

    if (hit) {
      const dmg = damageAfterArmor(w, target.armor, this.rng());
      target.hp -= dmg;
      if (target.hp <= 0) this.downUnit(target, shooter);
    }
  }

  private downUnit(u: Unit, by: Unit): void {
    u.hp = 0;
    if (u.faction === 'hostile') {
      u.alive = false;
      u.downed = false;
      u.combat = 'idle';
      this.events.push({ time: this.time, kind: 'kill', text: `Hostile down — ${by.name}.` });
    } else {
      u.downed = true;
      u.bleedout = BLEEDOUT_SECONDS;
      u.order = { kind: 'hold' };
      u.attention = 'down';
      this.events.push({ time: this.time, kind: 'down', text: `${u.name} is DOWN — bleeding out.` });
    }
  }

  // ── upkeep ──────────────────────────────────────────────────────────────────
  private decayAndBleed(dt: number): void {
    for (const u of this.units) {
      if (u.suppressedUntil <= this.time) {
        u.stress = Math.max(0, u.stress - STRESS_DECAY * dt);
      }
      if (u.downed && u.alive) {
        u.bleedout -= dt;
        if (u.bleedout <= 0) {
          u.alive = false;
          u.downed = false;
          this.events.push({ time: this.time, kind: 'kill', text: `${u.name} bled out. K.I.A.` });
        }
      }
    }
  }

  private pruneShots(): void {
    const cutoff = this.time - SHOT_TTL;
    let i = 0;
    while (i < this.shots.length && this.shots[i].time < cutoff) i++;
    if (i > 0) this.shots.splice(0, i);
  }

  // ── perception ──────────────────────────────────────────────────────────────
  /** Nearest enemy-faction unit this unit can shoot: active, in range, with LOS. */
  nearestVisibleEnemy(u: Unit): Unit | undefined {
    const w = weaponOf(u.weapon);
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const o of this.units) {
      if (!isActive(o) || o.faction === u.faction) continue;
      const d = tileDist(u.pos.x, u.pos.y, o.pos.x, o.pos.y);
      if (d > w.range) continue;
      if (d >= bestD) continue;
      if (
        !hasLineOfSight(
          this.grid,
          Math.floor(u.pos.x),
          Math.floor(u.pos.y),
          Math.floor(o.pos.x),
          Math.floor(o.pos.y),
        )
      )
        continue;
      best = o;
      bestD = d;
    }
    return best;
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
