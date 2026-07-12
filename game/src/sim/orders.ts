// Orders are first-class, serializable objects living ON the unit. This is the
// backbone of the plan-then-execute + PERSISTENT-order model (DESIGN §4.1): a unit
// keeps its standing order until you re-task it, so re-pausing only touches the
// units that changed — not all twelve. It's also what save/replay serializes.

import { Tile } from './grid';

export type Order =
  | { kind: 'hold' }
  /** Follow a planned path. `index` is the next node to reach. */
  | { kind: 'move'; path: Tile[]; index: number };

export const HOLD: Order = { kind: 'hold' };

export function moveOrder(path: Tile[]): Order {
  return { kind: 'move', path, index: 0 };
}

/** A move order is "done" once the unit has consumed every node in its path. */
export function isOrderComplete(order: Order): boolean {
  return order.kind === 'hold' || order.index >= order.path.length;
}
