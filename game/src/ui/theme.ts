// Visual tokens from the selected "1c CONSOLE" mockup direction (DESIGN §8).
// Colours are 0xRRGGBB numbers for Pixi and matching hex strings for the DOM UI.

export const COLORS = {
  navy: 0x05080d,
  panel: 0x0b1119,
  line: 0x16202e,
  floor: 0x080d14,
  wall: 0x1b2a3c,
  wallEdge: 0x2b405a,
  door: 0xff8b3d,
  cyan: 0x3fd0f0,
  cyanDim: 0x1c6f82,
  orange: 0xff8b3d,
  red: 0xff5c33,
  ink: 0xc9d6e2,
  muted: 0x5f7183,
  fogUnseen: 0x05080d,
  fogSeen: 0x070b12,
} as const;

export const CSS = {
  navy: '#05080d',
  panel: '#0b1119',
  line: '#16202e',
  cyan: '#3fd0f0',
  cyanDim: '#1c6f82',
  orange: '#ff8b3d',
  red: '#ff5c33',
  ink: '#c9d6e2',
  muted: '#5f7183',
} as const;

export const FONT_DISPLAY = "'Rajdhani', 'Segoe UI', system-ui, sans-serif";
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";

/** Faction accent colours extend the base palette (DESIGN §3). */
export const FACTION_ACCENT = {
  blackline: 0xd8e4ef, // steel white
  combine: 0xffc24d, // amber/gold
  drift: 0xff5c33, // rust / threat
  sodality: 0xb388ff, // violet
} as const;
