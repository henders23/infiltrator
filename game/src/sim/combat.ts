// Pure combat math — no state, no RNG. World.ts calls these with its seeded RNG so
// results stay deterministic and these stay unit-testable in isolation.

import { Weapon } from '../content/weapons';

/** Accuracy falls off past half the weapon's range, down to ~40% at max range. */
export function rangeFalloff(weapon: Weapon, dist: number): number {
  const sweet = weapon.range * 0.5;
  if (dist <= sweet) return 1;
  if (dist >= weapon.range) return 0.4;
  const t = (dist - sweet) / (weapon.range - sweet);
  return 1 - 0.6 * t;
}

/**
 * Chance to hit, 0.05..0.95. Combines base accuracy, range falloff, the target's
 * directional cover, and a penalty if the shooter is currently suppressed.
 */
export function hitChance(
  weapon: Weapon,
  dist: number,
  cover: number,
  shooterSuppressed: boolean,
): number {
  let c = weapon.accuracy * rangeFalloff(weapon, dist);
  c *= 1 - cover;
  if (shooterSuppressed) c *= 0.6;
  return Math.max(0.05, Math.min(0.95, c));
}

/** Damage after armour (armour reduced by the weapon's penetration). `roll` is 0..1. */
export function damageAfterArmor(weapon: Weapon, targetArmor: number, roll: number): number {
  const effectiveArmor = Math.max(0, targetArmor - weapon.armorPen);
  const base = Math.max(3, weapon.damage - effectiveArmor);
  const variance = 0.85 + 0.3 * roll; // ±15%
  return Math.round(base * variance);
}
