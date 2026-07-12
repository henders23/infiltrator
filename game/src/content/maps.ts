// Authored mission content. Content is data, separate from sim systems (BUILD_PLAN
// §1) — this demo deck is a two-room boarding scenario: entry corridor on the left,
// two rooms behind breaching doors on the right, hostiles inside.

import { DOOR, Grid, WALL } from '../sim/grid';
import { makeUnit, Unit } from '../sim/unit';

export interface Mission {
  name: string;
  grid: Grid;
  units: Unit[];
  seed: number;
}

export function makeDemoMission(): Mission {
  const W = 34;
  const H = 20;
  const g = new Grid(W, H); // defaults to all FLOOR

  const wallRect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.set(x, y, WALL);
  };

  // hull border
  wallRect(0, 0, W - 1, 0);
  wallRect(0, H - 1, W - 1, H - 1);
  wallRect(0, 0, 0, H - 1);
  wallRect(W - 1, 0, W - 1, H - 1);

  // spine bulkhead dividing entry (left) from the two rooms (right), two doors
  wallRect(12, 1, 12, H - 2);
  g.set(12, 6, DOOR); // door to upper room approach
  g.set(12, 13, DOOR); // door to lower room approach

  // horizontal divider splitting the right side into an upper and a lower room
  wallRect(13, 9, W - 2, 9);
  g.set(22, 9, DOOR); // internal connecting door

  const units: Unit[] = [
    // fireteam — spawns in the entry corridor, planned individually
    makeUnit({ name: 'CPL. VOSS', faction: 'friendly', pos: { x: 2.5, y: 3.5 }, hp: 100 }),
    makeUnit({ name: 'PVT. OKORO', faction: 'friendly', pos: { x: 3.5, y: 5.5 }, hp: 100 }),
    makeUnit({ name: 'PVT. REYES', faction: 'friendly', pos: { x: 2.5, y: 8.5 }, hp: 100 }),
    makeUnit({ name: 'SPC. DANN', faction: 'friendly', pos: { x: 3.5, y: 10.5 }, hp: 100 }),
    // hostiles hold position (no combat AI until M2) — used here to test fog reveal
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 26.5, y: 4.5 }, hp: 100 }),
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 29.5, y: 6.5 }, hp: 100 }),
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 25.5, y: 15.5 }, hp: 100 }),
  ];

  return { name: 'DERELICT — TWO-ROOM BOARDING', grid: g, units, seed: 20260712 };
}
