// The deterministic tactical world. `step(dt)` advances one FIXED tick — no
// rendering, no DOM, no wall-clock, no Math.random. Everything the player sees is
// derived from this state; everything they do becomes an Order consumed here.
//
// M2 added combat. M3 adds the Door Kickers layer: doors that seal rooms (block move
// + sight) until opened quietly or breached loud, flash/frag grenades, overwatch arcs,
// stun, and noise that wakes defenders — so entries become the puzzle.

import { coverMitigation } from './cover';
import { damageAfterArmor, hitChance } from './combat';
import { DOOR, Grid } from './grid';
import { hasLineOfSight, tileDist } from './los';
import { currentStep, GrenadeType, holdOrder, isPlanComplete, Step } from './orders';
import { makeRng, Rng } from './rng';
import { isActive, isStunned, Unit } from './unit';
import { weaponOf } from '../content/weapons';

export interface WorldEvent {
  time: number;
  kind: 'path-complete' | 'contact' | 'engage' | 'hit' | 'down' | 'kill' | 'breach' | 'grenade' | 'info';
  text: string;
}

export interface Shot {
  time: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  hit: boolean;
  faction: Unit['faction'];
}

/** A grenade/breach detonation kept briefly for the renderer. */
export interface Blast {
  time: number;
  pos: { x: number; y: number };
  radius: number;
  kind: GrenadeType | 'breach';
}

export const REVEAL_RADIUS = 6;
const ARRIVE_EPS = 0.02;
const SUPPRESS_SECONDS = 1.4;
const STRESS_DECAY = 10;
const BLEEDOUT_SECONDS = 22;
const AI_REACTION = 0.5;
const SHOT_TTL = 0.12;
const BLAST_TTL = 0.4;
const ENGAGE_HYSTERESIS = 2.5;

const STUN_BREACH = 2.0;
const STUN_FLASH = 3.0;
const BREACH_STUN_RADIUS = 3;
const FLASH_RADIUS = 3.5;
const FRAG_RADIUS = 2.6;
const FRAG_DAMAGE = 60;
const FRAG_PEN = 20;
const NOISE_RADIUS = 9;
const GUNFIRE_NOISE = 6;
const OVERWATCH_COS = 0.5; // ~120° cone

export class World {
  readonly grid: Grid;
  readonly units: Unit[];
  readonly rng: Rng;
  time = 0;
  readonly seen = new Set<number>();
  readonly events: WorldEvent[] = [];
  readonly shots: Shot[] = [];
  readonly blasts: Blast[] = [];
  /** Tile indices of doors currently open (all doors start closed). */
  readonly openDoors = new Set<number>();

  constructor(grid: Grid, units: Unit[], seed = 1) {
    this.grid = grid;
    this.units = units;
    this.rng = makeRng(seed);
    this.revealFog();
  }

  unit(id: number): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  // ── door / sight helpers ────────────────────────────────────────────────────
  isDoorClosed(x: number, y: number): boolean {
    return this.grid.get(x, y) === DOOR && !this.openDoors.has(this.grid.idx(x, y));
  }
  /** Blocks line of sight: walls and closed doors. */
  opaqueAt = (x: number, y: number): boolean => this.grid.isWall(x, y) || this.isDoorClosed(x, y);

  step(dt: number): void {
    this.time += dt;
    for (const u of this.units) {
      if (isActive(u) && u.faction === 'friendly') this.advance(u, dt);
    }
    this.updateAI(dt);
    this.runCombat(dt);
    this.decayAndBleed(dt);
    this.prune();
    this.revealFog();
  }

  // ── plan execution (step machine) ───────────────────────────────────────────
  private advance(u: Unit, dt: number): void {
    if (isStunned(u, this.time)) return;
    const s = currentStep(u.order);
    switch (s.kind) {
      case 'move':
        // suppressed units are pinned — hold the order, can't advance
        if (u.suppressedUntil <= this.time) this.runMove(u, s, dt);
        break;
      case 'breach':
        this.faceToward(u, s.door.x + 0.5, s.door.y + 0.5);
        s.timer -= dt;
        if (s.timer <= 0) {
          this.forceDoor(s.door, u);
          u.order.step++;
        }
        break;
      case 'grenade':
        this.faceToward(u, s.target.x + 0.5, s.target.y + 0.5);
        s.thrown = true;
        s.fuse -= dt;
        if (s.fuse <= 0) {
          this.detonate(s.target, s.gtype, u);
          u.order.step++;
        }
        break;
      case 'overwatch':
        u.facing.x = s.dir.x;
        u.facing.y = s.dir.y;
        break;
      case 'hold':
        break;
    }
    // fell off the end of the plan → stand down to a hold posture (once)
    if (u.order.step >= u.order.steps.length) {
      if (u.attention !== 'path-complete') {
        u.attention = 'path-complete';
        this.events.push({ time: this.time, kind: 'path-complete', text: `${u.name} set.` });
      }
      u.order = holdOrder();
    }
  }

  private runMove(u: Unit, s: Extract<Step, { kind: 'move' }>, dt: number): void {
    let budget = u.speed * dt;
    while (budget > 0 && s.index < s.path.length) {
      const node = s.path[s.index];
      const tx = node.x + 0.5;
      const ty = node.y + 0.5;
      const dx = tx - u.pos.x;
      const dy = ty - u.pos.y;
      const d = Math.hypot(dx, dy);
      if (d <= ARRIVE_EPS) {
        u.pos.x = tx;
        u.pos.y = ty;
        this.onEnterTile(node.x, node.y);
        s.index++;
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
        this.onEnterTile(node.x, node.y);
        s.index++;
      }
    }
    if (s.index >= s.path.length) u.order.step++;
  }

  /** Walking onto a closed door opens it quietly — the default, silent entry. */
  private onEnterTile(x: number, y: number): void {
    if (this.isDoorClosed(x, y)) {
      this.openDoors.add(this.grid.idx(x, y));
      this.events.push({ time: this.time, kind: 'info', text: 'Door opened.' });
    }
  }

  private forceDoor(door: { x: number; y: number }, by: Unit): void {
    this.openDoors.add(this.grid.idx(door.x, door.y));
    this.blasts.push({ time: this.time, pos: { x: door.x + 0.5, y: door.y + 0.5 }, radius: BREACH_STUN_RADIUS, kind: 'breach' });
    this.events.push({ time: this.time, kind: 'breach', text: `${by.name} breaches the door.` });
    // stun the defenders beyond — the payoff for going loud
    for (const o of this.units) {
      if (!isActive(o) || o.faction === by.faction) continue;
      if (tileDist(o.pos.x, o.pos.y, door.x + 0.5, door.y + 0.5) <= BREACH_STUN_RADIUS) {
        o.stunnedUntil = Math.max(o.stunnedUntil, this.time + STUN_BREACH);
        o.stress = Math.min(100, o.stress + 30);
      }
    }
    this.makeNoise(door.x + 0.5, door.y + 0.5);
  }

  private detonate(target: { x: number; y: number }, gtype: GrenadeType, by: Unit): void {
    const radius = gtype === 'flash' ? FLASH_RADIUS : FRAG_RADIUS;
    this.blasts.push({ time: this.time, pos: { x: target.x + 0.5, y: target.y + 0.5 }, radius, kind: gtype });
    this.events.push({
      time: this.time,
      kind: 'grenade',
      text: gtype === 'flash' ? `${by.name}: flashbang out.` : `${by.name}: frag out.`,
    });
    for (const o of this.units) {
      if (!isActive(o)) continue; // grenades don't discriminate — mind your own team
      if (tileDist(o.pos.x, o.pos.y, target.x + 0.5, target.y + 0.5) > radius) continue;
      if (gtype === 'flash') {
        o.stunnedUntil = Math.max(o.stunnedUntil, this.time + STUN_FLASH);
        o.stress = Math.min(100, o.stress + 40);
      } else {
        const dmg = Math.max(5, FRAG_DAMAGE - Math.max(0, o.armor - FRAG_PEN));
        o.hp -= dmg;
        if (o.hp <= 0) this.downUnit(o, by);
      }
    }
    this.makeNoise(target.x + 0.5, target.y + 0.5);
  }

  /** Loud events (breach, grenade, gunfire) wake idle defenders within earshot. */
  private makeNoise(x: number, y: number, radius = NOISE_RADIUS): void {
    for (const h of this.units) {
      if (!isActive(h) || h.faction !== 'hostile') continue;
      if (h.combat === 'idle' && tileDist(h.pos.x, h.pos.y, x, y) <= radius) {
        h.combat = 'alert';
        h.combatTimer = AI_REACTION;
      }
    }
  }

  // ── hostile AI ──────────────────────────────────────────────────────────────
  private updateAI(dt: number): void {
    for (const h of this.units) {
      if (!isActive(h) || h.faction !== 'hostile' || isStunned(h, this.time)) continue;
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
          if (target && h.combatTimer <= 0) {
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
      if (!isActive(u) || isStunned(u, this.time)) continue;
      u.fireCooldown = Math.max(0, u.fireCooldown - dt);

      const step = currentStep(u.order);
      const onOverwatch = step.kind === 'overwatch';
      const mayFire = u.faction === 'hostile' ? u.combat === 'engage' : u.weaponsFree || onOverwatch;
      if (!mayFire) continue;

      const arc = onOverwatch ? (step as Extract<Step, { kind: 'overwatch' }>).dir : null;
      const target = this.nearestVisibleEnemy(u, arc);
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
    this.faceToward(shooter, target.pos.x, target.pos.y);

    const chance = hitChance(w, dist, cover, shooter.suppressedUntil > this.time);
    const hit = this.rng() < chance;

    target.stress = Math.min(100, target.stress + w.suppression);
    target.suppressedUntil = Math.max(target.suppressedUntil, this.time + SUPPRESS_SECONDS);

    this.shots.push({
      time: this.time,
      from: { x: shooter.pos.x, y: shooter.pos.y },
      to: { x: target.pos.x, y: target.pos.y },
      hit,
      faction: shooter.faction,
    });
    // gunfire is loud — nearby idle defenders hear it
    if (shooter.faction === 'friendly') this.makeNoise(shooter.pos.x, shooter.pos.y, GUNFIRE_NOISE);

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
      u.order = holdOrder();
      u.attention = 'down';
      this.events.push({ time: this.time, kind: 'down', text: `${u.name} is DOWN — bleeding out.` });
    }
  }

  private decayAndBleed(dt: number): void {
    for (const u of this.units) {
      if (u.suppressedUntil <= this.time) u.stress = Math.max(0, u.stress - STRESS_DECAY * dt);
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

  private prune(): void {
    const shotCut = this.time - SHOT_TTL;
    let i = 0;
    while (i < this.shots.length && this.shots[i].time < shotCut) i++;
    if (i > 0) this.shots.splice(0, i);
    const blastCut = this.time - BLAST_TTL;
    let j = 0;
    while (j < this.blasts.length && this.blasts[j].time < blastCut) j++;
    if (j > 0) this.blasts.splice(0, j);
  }

  // ── perception ──────────────────────────────────────────────────────────────
  /** Nearest enemy this unit can shoot: active, in range, in LOS, and (if given) in arc. */
  nearestVisibleEnemy(u: Unit, arc?: { x: number; y: number } | null): Unit | undefined {
    const w = weaponOf(u.weapon);
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const o of this.units) {
      if (!isActive(o) || o.faction === u.faction) continue;
      const dx = o.pos.x - u.pos.x;
      const dy = o.pos.y - u.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > w.range || d >= bestD) continue;
      if (arc) {
        const inv = 1 / (d || 1);
        if (arc.x * dx * inv + arc.y * dy * inv < OVERWATCH_COS) continue;
      }
      if (
        !hasLineOfSight(
          this.grid,
          Math.floor(u.pos.x),
          Math.floor(u.pos.y),
          Math.floor(o.pos.x),
          Math.floor(o.pos.y),
          this.opaqueAt,
        )
      )
        continue;
      best = o;
      bestD = d;
    }
    return best;
  }

  private faceToward(u: Unit, x: number, y: number): void {
    const dx = x - u.pos.x;
    const dy = y - u.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    u.facing.x = dx / d;
    u.facing.y = dy / d;
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

export function isPlanActive(u: Unit): boolean {
  return !isPlanComplete(u.order);
}
