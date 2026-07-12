import { HOLD, Order } from './orders';

export type Faction = 'friendly' | 'hostile';

/** Why the command layer is flagging this unit for the player's attention. */
export type Attention = 'path-complete' | 'contact' | null;

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
  alive: boolean;
  /** Movement speed in tiles per second. */
  speed: number;
  /** The unit's standing order. Persists across pauses until re-tasked. */
  order: Order;
  attention: Attention;
}

let nextId = 1;

export function makeUnit(init: Partial<Unit> & Pick<Unit, 'name' | 'faction'>): Unit {
  return {
    id: init.id ?? nextId++,
    name: init.name,
    faction: init.faction,
    pos: init.pos ?? { x: 0, y: 0 },
    facing: init.facing ?? { x: 1, y: 0 },
    hp: init.hp ?? 100,
    maxHp: init.maxHp ?? init.hp ?? 100,
    alive: init.alive ?? true,
    speed: init.speed ?? 4,
    order: init.order ?? HOLD,
    attention: init.attention ?? null,
  };
}
