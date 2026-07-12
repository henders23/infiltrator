// Weapon data (content, not systems). Each weapon carries a HULL-SAFE RATING — the
// signature system (DESIGN §4.3): breaching weapons hit hard but will crack a hull.
// The rating is data now; venting reads it in M4.

export type HullSafety = 'safe' | 'risk' | 'breaching';

export interface Weapon {
  id: string;
  name: string;
  /** Base damage before armour. */
  damage: number;
  /** Effective range in tiles (accuracy falls off past ~half this). */
  range: number;
  /** Base hit chance at optimal range, 0..1. */
  accuracy: number;
  /** Seconds between shots. */
  fireInterval: number;
  /** Flat armour ignored. */
  armorPen: number;
  /** Stress inflicted on a target under fire (per shot, hit or miss). */
  suppression: number;
  hullSafety: HullSafety;
}

export const WEAPONS: Record<string, Weapon> = {
  carbine: {
    id: 'carbine',
    name: 'M-7 Carbine',
    damage: 26,
    range: 9,
    accuracy: 0.72,
    fireInterval: 0.8,
    armorPen: 8,
    suppression: 10,
    hullSafety: 'risk',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Breacher Shotgun',
    damage: 46,
    range: 4,
    accuracy: 0.86,
    fireInterval: 1.0,
    armorPen: 4,
    suppression: 14,
    hullSafety: 'safe',
  },
  saw: {
    id: 'saw',
    name: 'M-250 SAW',
    damage: 18,
    range: 10,
    accuracy: 0.5,
    fireInterval: 0.26,
    armorPen: 14,
    suppression: 26,
    hullSafety: 'breaching',
  },
  pistol: {
    id: 'pistol',
    name: 'Sidearm',
    damage: 16,
    range: 6,
    accuracy: 0.7,
    fireInterval: 0.7,
    armorPen: 2,
    suppression: 6,
    hullSafety: 'safe',
  },
};

export function weaponOf(id: string): Weapon {
  return WEAPONS[id] ?? WEAPONS.carbine;
}
