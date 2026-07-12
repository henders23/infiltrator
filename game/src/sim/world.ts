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

// hull / decompression
const DIFF_RATE = 15; // pressure diffusion coefficient (per pass; clamped for stability)
const DIFF_PASSES = 4; // diffusion sub-steps per tick — a room vacuums in a few seconds
const DECOMP_DMG = 40; // damage/sec at the breach while air is still rushing out
const ASPHYX_DMG = 20; // damage/sec in low-oxygen vacuum
const PULL_SPEED = 3.0; // tiles/sec dragged toward the breach, at the breach (< move speed: run!)
const PULL_RADIUS = 6; // pull + violent damage fall off to zero past this many tiles from a breach
const VIOLENT_MIN = 0.12; // pressure above this (and connected) = air still rushing
const VACUUM_MAX = 0.5; // pressure below this = not enough oxygen to breathe (hypoxia)

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
  /** Tile indices of hull breaches (holes to space). Sources of decompression. */
  readonly breaches = new Set<number>();
  /** Per-tile atmospheric pressure, 0 (vacuum) .. 1 (full atmo). */
  readonly pressure: Float32Array;
  private readonly pressureScratch: Float32Array;
  /** Tiles currently connected to a breach through open air (the active vent front). */
  readonly venting = new Set<number>();

  constructor(grid: Grid, units: Unit[], seed = 1) {
    this.grid = grid;
    this.units = units;
    this.rng = makeRng(seed);
    this.pressure = new Float32Array(grid.width * grid.height).fill(1);
    this.pressureScratch = new Float32Array(grid.width * grid.height);
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

  /** A wall on the ship's exterior — breaching it vents to space (vs an interior bulkhead). */
  isHullWall(x: number, y: number): boolean {
    if (!this.grid.isWall(x, y)) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!this.grid.inBounds(x + dx, y + dy)) return true; // touches the outside
    }
    return false;
  }
  pressureAt(x: number, y: number): number {
    return this.grid.inBounds(x, y) ? this.pressure[this.grid.idx(x, y)] : 0;
  }
  /** Air still rushing out here (dangerous pull + fast damage). */
  isViolent(x: number, y: number): boolean {
    return this.venting.has(this.grid.idx(x, y)) && this.pressureAt(x, y) > VIOLENT_MIN;
  }

  step(dt: number): void {
    this.time += dt;
    for (const u of this.units) {
      if (isActive(u) && u.faction === 'friendly') this.advance(u, dt);
    }
    this.updateAI(dt);
    this.runCombat(dt);
    this.updateHull(dt);
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
      case 'hullcharge':
        this.faceToward(u, s.wall.x + 0.5, s.wall.y + 0.5);
        s.timer -= dt;
        if (s.timer <= 0) {
          this.openHullBreach(s.wall, u);
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

  private openHullBreach(wall: { x: number; y: number }, by: Unit): void {
    // a charge tears a ~3-wide hole along the hull, so a room actually vacuums fast
    this.breaches.add(this.grid.idx(wall.x, wall.y));
    const horizontal = this.isHullWall(wall.x + 1, wall.y) || this.isHullWall(wall.x - 1, wall.y);
    for (const d of [-1, 1]) {
      const wx = horizontal ? wall.x + d : wall.x;
      const wy = horizontal ? wall.y : wall.y + d;
      if (this.isHullWall(wx, wy)) this.breaches.add(this.grid.idx(wx, wy));
    }
    this.blasts.push({ time: this.time, pos: { x: wall.x + 0.5, y: wall.y + 0.5 }, radius: 3, kind: 'breach' });
    this.events.push({ time: this.time, kind: 'breach', text: `${by.name} blows the hull — compartment venting!` });
    this.makeNoise(wall.x + 0.5, wall.y + 0.5);
  }

  // ── decompression ─────────────────────────────────────────────────────────
  /** Drain pressure from every tile connected to a breach, and punish anyone caught. */
  private updateHull(dt: number): void {
    if (this.breaches.size === 0) return;

    // multi-source flood from the breaches through open air (walls + CLOSED doors bound it)
    this.venting.clear();
    const queue: number[] = [];
    for (const b of this.breaches) {
      const bx = b % this.grid.width;
      const by = Math.floor(b / this.grid.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = bx + dx;
        const ny = by + dy;
        if (this.ventPassable(nx, ny)) {
          const ni = this.grid.idx(nx, ny);
          if (!this.venting.has(ni)) {
            this.venting.add(ni);
            queue.push(ni);
          }
        }
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const cx = queue[h] % this.grid.width;
      const cy = Math.floor(queue[h] / this.grid.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.ventPassable(nx, ny)) continue;
        const ni = this.grid.idx(nx, ny);
        if (!this.venting.has(ni)) {
          this.venting.add(ni);
          queue.push(ni);
        }
      }
    }

    // diffuse pressure: air flows toward lower-pressure neighbours; breaches are a 0-sink,
    // walls and CLOSED doors don't conduct (so a sealed room keeps — or traps — its air).
    // Sub-step so a whole room vacuums in a handful of seconds while staying stable.
    const coeff = Math.min(0.24, DIFF_RATE * dt);
    for (let pass = 0; pass < DIFF_PASSES; pass++) this.diffusePressure(coeff);

    // punish exposed units. The violent pull + decompression damage are strongest AT the
    // breach and fall to nothing past PULL_RADIUS, so you get sucked out standing next to
    // the hole — but a corridor away you just breathe thinning air (and can still flee).
    for (const u of this.units) {
      if (!u.alive || u.suit) continue;
      const p = this.pressureAt(Math.floor(u.pos.x), Math.floor(u.pos.y));
      const connected = this.venting.has(this.grid.idx(Math.floor(u.pos.x), Math.floor(u.pos.y)));
      let violent = false;
      if (connected && p > VIOLENT_MIN) {
        const distToBreach = this.nearestBreachDist(u.pos.x, u.pos.y);
        const falloff = Math.max(0, 1 - distToBreach / PULL_RADIUS);
        if (falloff > 0) {
          violent = true;
          this.pullTowardBreach(u, dt, falloff);
          u.hp -= DECOMP_DMG * falloff * dt;
        }
      }
      if (p < VACUUM_MAX) u.hp -= ASPHYX_DMG * dt;
      if (u.hp <= 0 && u.alive) this.killByHull(u, violent ? 'was blown out the breach' : 'asphyxiated');
    }
  }

  private nearestBreachDist(fx: number, fy: number): number {
    let best = Infinity;
    for (const b of this.breaches) {
      const bx = (b % this.grid.width) + 0.5;
      const by = Math.floor(b / this.grid.width) + 0.5;
      best = Math.min(best, tileDist(fx, fy, bx, by));
    }
    return best;
  }

  /** A tile air can flow into: in-bounds, not a wall, not a closed door. */
  private ventPassable(x: number, y: number): boolean {
    return this.grid.inBounds(x, y) && !this.grid.isWall(x, y) && !this.isDoorClosed(x, y);
  }

  /** One double-buffered diffusion pass over the pressure field. */
  private diffusePressure(coeff: number): void {
    const w = this.grid.width;
    const P = this.pressure;
    const N = this.pressureScratch;
    N.set(P);
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < w; x++) {
        if (this.grid.isWall(x, y) || this.isDoorClosed(x, y)) continue;
        const idx = y * w + x;
        const p = P[idx];
        let flux = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.grid.inBounds(nx, ny)) continue;
          const ni = ny * w + nx;
          if (this.breaches.has(ni)) flux += 0 - p; // open to space
          else if (!this.grid.isWall(nx, ny) && !this.isDoorClosed(nx, ny)) flux += P[ni] - p;
        }
        N[idx] = Math.max(0, Math.min(1, p + coeff * flux));
      }
    }
    P.set(N);
  }

  private pullTowardBreach(u: Unit, dt: number, strength: number): void {
    // drift toward the nearest breach; blocked by walls/closed doors (you hit the bulkhead)
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const b of this.breaches) {
      const bx = (b % this.grid.width) + 0.5;
      const by = Math.floor(b / this.grid.width) + 0.5;
      const d = tileDist(u.pos.x, u.pos.y, bx, by);
      if (d < bestD) {
        bestD = d;
        best = { x: bx, y: by };
      }
    }
    if (!best) return;
    const dx = best.x - u.pos.x;
    const dy = best.y - u.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = u.pos.x + (dx / d) * PULL_SPEED * strength * dt;
    const ny = u.pos.y + (dy / d) * PULL_SPEED * strength * dt;
    if (!this.grid.isWall(Math.floor(nx), Math.floor(ny)) && !this.isDoorClosed(Math.floor(nx), Math.floor(ny))) {
      u.pos.x = nx;
      u.pos.y = ny;
    }
  }

  private killByHull(u: Unit, cause: string): void {
    u.hp = 0;
    u.alive = false;
    u.downed = false;
    u.combat = 'idle';
    this.events.push({ time: this.time, kind: 'kill', text: `${u.name} ${cause}.` });
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
