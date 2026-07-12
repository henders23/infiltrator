// Orders are first-class, serializable PLANS living on the unit — the backbone of
// plan-then-execute + PERSISTENT orders (DESIGN §4.1). M3 turns a plan into a sequence
// of steps: move legs plus action waypoints (breach a door, throw a grenade, set
// overwatch). A unit runs its steps in order, then falls to a standing posture it holds
// until re-tasked. Everything here is plain data — it serializes for save/replay.

import { Tile } from './grid';

export type Vec = { x: number; y: number };
export type GrenadeType = 'frag' | 'flash';

export type Step =
  /** Walk a path; `index` is the next node to reach. */
  | { kind: 'move'; path: Tile[]; index: number }
  /** Loudly force a door: instant open + stun beyond it, but makes noise. `timer` counts down. */
  | { kind: 'breach'; door: Tile; timer: number }
  /** Blow a charge on a HULL wall to vent the compartment to vacuum. Needs a breaching weapon. */
  | { kind: 'hullcharge'; wall: Tile; timer: number }
  /** Throw a grenade at a tile. `fuse` counts down after `thrown`. */
  | { kind: 'grenade'; target: Tile; gtype: GrenadeType; fuse: number; thrown: boolean }
  /** Terminal standing posture: hold and watch an arc, firing only within it. */
  | { kind: 'overwatch'; dir: Vec }
  /** Terminal: hold position. */
  | { kind: 'hold' };

export interface Order {
  steps: Step[];
  step: number; // index of the current step
}

export const BREACH_TIME = 0.6; // seconds to force a door
export const GRENADE_FUSE = 0.9; // seconds from throw to detonation
export const HULLCHARGE_TIME = 1.0; // seconds to set + blow a hull charge

export function holdOrder(): Order {
  return { steps: [{ kind: 'hold' }], step: 0 };
}

export function moveOrder(path: Tile[]): Order {
  return { steps: [{ kind: 'move', path, index: 0 }], step: 0 };
}

export function currentStep(o: Order): Step {
  return o.steps[Math.min(o.step, o.steps.length - 1)];
}

/** Terminal steps are stable postures the unit sits on until re-tasked. */
export function isTerminalStep(s: Step): boolean {
  return s.kind === 'hold' || s.kind === 'overwatch';
}

/** True once there are no transient steps left to execute. */
export function isPlanComplete(o: Order): boolean {
  return o.step >= o.steps.length || isTerminalStep(currentStep(o));
}
