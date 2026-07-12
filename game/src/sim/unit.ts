import { HOLD, Order } from './orders';

export type Faction = 'friendly' | 'hostile';

/** Why the command layer is flagging this unit for the player's attention. */
export type Attention = 'path-complete' | 'contact' | 'down' | null;

/** Coarse combat posture (mostly drives hostile AI; friendlies are always weapons-free). */
export type CombatState = 'idle' | 'alert' | 'engage';

export interface Unit {
  id: number;
  name: string;
  faction: Faction;
  /** Position in tile-space (floats allow smooth sub-tile movement). */
  pos: { x: number; y: number };
  /** Facing as a unit vector; drives which way the soldier looks/aims. */
  facing: { x: number; y: number };
  hp: number;
  maxHp: number;
  /** In the fight. False = dead. A downed unit is alive but out of action. */
  alive: boolean;
  /** Bleeding out — alive but incapacitated. Friendly downs bleed toward death. */
  downed: boolean;
  /** Seconds of life left while downed (M7 adds stabilize/drag; M2 they bleed out). */
  bleedout: number;
  /** Movement speed in tiles per second. */
  speed: number;

  // ── loadout & combat ──────────────────────────────────────────────────────
  weapon: string; // key into content/weapons
  armor: number; // flat damage soak, cut by weapon armour penetration
  stress: number; // 0..100 — rises under fire; drives suppression/panic
  /** Sim-time until which the unit is suppressed (pinned, worse aim). */
  suppressedUntil: number;
  /** Seconds until this unit may fire again. */
  fireCooldown: number;
  /** Hostile AI posture + reaction timer + current target. */
  combat: CombatState;
  combatTimer: number;
  targetId: number | null;

  /** The unit's standing order. Persists across pauses until re-tasked. */
  order: Order;
  attention: Attention;
}

let nextId = 1;

export function makeUnit(init: Partial<Unit> & Pick<Unit, 'name' | 'faction'>): Unit {
  const hp = init.hp ?? 100;
  return {
    id: init.id ?? nextId++,
    name: init.name,
    faction: init.faction,
    pos: init.pos ?? { x: 0, y: 0 },
    facing: init.facing ?? { x: 1, y: 0 },
    hp,
    maxHp: init.maxHp ?? hp,
    alive: init.alive ?? true,
    downed: init.downed ?? false,
    bleedout: init.bleedout ?? 0,
    speed: init.speed ?? 4,
    weapon: init.weapon ?? 'carbine',
    armor: init.armor ?? 10,
    stress: init.stress ?? 0,
    suppressedUntil: init.suppressedUntil ?? 0,
    fireCooldown: init.fireCooldown ?? 0,
    combat: init.combat ?? 'idle',
    combatTimer: init.combatTimer ?? 0,
    targetId: init.targetId ?? null,
    order: init.order ?? HOLD,
    attention: init.attention ?? null,
  };
}

/** A unit that can perceive, move, and shoot this tick. */
export function isActive(u: Unit): boolean {
  return u.alive && !u.downed;
}
