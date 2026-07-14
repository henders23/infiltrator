import { holdOrder, Order } from './orders';

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
  /** Body facing as a unit vector — the direction of travel; drives sprite rotation. */
  facing: { x: number; y: number };
  /** Weapon aim as a unit vector — decoupled from facing so a soldier can move one way and fire another. */
  aim: { x: number; y: number };
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
  /** Sim-time until which the unit is stunned by a breach/flash (can't act at all). */
  stunnedUntil: number;
  /** Weapons-free (fires on sight) vs hold-fire (won't initiate). */
  weaponsFree: boolean;
  /** Sealed EVA suit — immune to decompression pull, spacing, and asphyxiation. */
  suit: boolean;
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
  const facing = init.facing ?? { x: 1, y: 0 };
  return {
    id: init.id ?? nextId++,
    name: init.name,
    faction: init.faction,
    pos: init.pos ?? { x: 0, y: 0 },
    facing,
    aim: init.aim ?? { ...facing },
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
    stunnedUntil: init.stunnedUntil ?? 0,
    weaponsFree: init.weaponsFree ?? true,
    suit: init.suit ?? false,
    fireCooldown: init.fireCooldown ?? 0,
    combat: init.combat ?? 'idle',
    combatTimer: init.combatTimer ?? 0,
    targetId: init.targetId ?? null,
    order: init.order ?? holdOrder(),
    attention: init.attention ?? null,
  };
}

/** A unit that can perceive, move, and shoot this tick. */
export function isActive(u: Unit): boolean {
  return u.alive && !u.downed;
}

/** Stunned units are alive but can't move, shoot, or react. */
export function isStunned(u: Unit, time: number): boolean {
  return u.stunnedUntil > time;
}
