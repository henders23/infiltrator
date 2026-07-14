// Authored mission content. Content is data, separate from sim systems (BUILD_PLAN
// §1). This deck is traced tile-for-tile from the ship-plan art the renderer draws
// underneath it (src/assets/ship-deck.jpg): engines aft (left), crew rooms along the
// top, cargo/quarters along the bottom, three core rooms amidships, bridge at the bow.
// ' ' is open space outside the hull — venting a hull wall opens the room to vacuum.

import { Grid, gridFromAscii } from '../sim/grid';
import { makeUnit, Unit } from '../sim/unit';

export interface Mission {
  name: string;
  grid: Grid;
  units: Unit[];
  seed: number;
}

/** 60×33 deck plan, aligned 1:1 with the ship art (one tile ≈ 28 image px). */
function shipDeck(): Grid {
  return gridFromAscii([
    '                                                            ',
    '                                                            ',
    '                                                            ',
    '         ####################################               ',
    '        ###..##.###.##.#......#....#..#.....####            ',
    '        ###.....#......#......##...#..#.....######          ',
    '        #.......#......#...##.##...#..#.....########        ',
    '        #.......#......#...##.#....#..+.....#########       ',
    '        #.......#......#......#....#..#.....##########      ',
    '        #.......#......#......#....#..#.....#........#      ',
    '        ######++###++#######++###++#####++###.........#     ',
    '        #....#................................+........#    ',
    '        ###..#................................+.........#   ',
    '        ###..#...######.########...#######+##........#..#   ',
    '        #....#...#.####.#......#...#.....#.##.........#..#  ',
    '        #....+...+....#.+.####.+...+.##....#+.......#..#.#  ',
    '        ###..+...+....#.+.####.+...+.......#+.......#..#.#  ',
    '        ###..#...#.#..#.#......#...#.......##.........#..#  ',
    '        ###..#...######.########...##########........#..#   ',
    '        #....#................................+.........#   ',
    '        #....#................................+........#    ',
    '        ######++###++#######++###++######++##.........#     ',
    '        #.......#......#......#.....#..#....#........#      ',
    '        #.......###....#......#.##..#..#....##########      ',
    '        #...##..#.#....#.##...#..#..+..#....########        ',
    '        #...##..##.....#......#..#..#..+....#######         ',
    '        #.......#......#......#.....#..#....#####           ',
    '        #################################### ##             ',
    '         ###################################                ',
    '                                                            ',
    '                                                            ',
    '                                                            ',
    '                                                            ',
  ]);
}

export function makeDemoMission(): Mission {
  const g = shipDeck();

  const units: Unit[] = [
    // fireteam — boards through the aft airlock into the port corridor junction
    makeUnit({
      name: 'CPL. VOSS',
      faction: 'friendly',
      pos: { x: 14.5, y: 11.5 },
      facing: { x: 1, y: 0 },
      weapon: 'carbine',
      armor: 14,
    }),
    makeUnit({
      name: 'PVT. OKORO',
      faction: 'friendly',
      pos: { x: 15.5, y: 12.5 },
      facing: { x: 1, y: 0 },
      weapon: 'shotgun',
      armor: 12,
    }),
    makeUnit({
      name: 'PVT. REYES',
      faction: 'friendly',
      pos: { x: 14.5, y: 12.5 },
      facing: { x: 1, y: 0 },
      weapon: 'carbine',
      armor: 12,
    }),
    makeUnit({
      name: 'SPC. DANN',
      faction: 'friendly',
      pos: { x: 15.5, y: 11.5 },
      facing: { x: 1, y: 0 },
      weapon: 'saw', // hull-breaching — the squad's hull specialist (can VENT)
      armor: 16,
      suit: true, // EVA suit: can vent a room and walk in after
    }),
    // defenders spread through the ship; AI wakes on contact/noise
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 20.5, y: 6.5 }, weapon: 'carbine', armor: 6 }), // bunkroom
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 25.5, y: 7.5 }, weapon: 'pistol', armor: 4 }), // mess hall
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 21.5, y: 24.5 }, weapon: 'shotgun', armor: 6 }, ), // cargo hold
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 25.5, y: 17.5 }, weapon: 'carbine', armor: 8 }), // reactor ring
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 34.5, y: 24.5 }, weapon: 'pistol', armor: 4 }), // lounge
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 40.5, y: 16.5 }, weapon: 'carbine', armor: 6 }), // workshop
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 47.5, y: 12.5 }, weapon: 'carbine', armor: 8 }), // bridge
    makeUnit({ name: 'HOSTILE', faction: 'hostile', pos: { x: 50.5, y: 17.5 }, weapon: 'pistol', armor: 6 }), // bridge
  ];

  return { name: 'MV CASPIAN — DECK SWEEP', grid: g, units, seed: 20260712 };
}
