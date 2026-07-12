# INFILTRATOR — game (M0 + M1 + M2)

The production build of INFILTRATOR. This directory implements **M0** (scaffold +
deterministic loop), **M1** (plan-then-execute movement with persistent orders), and
**M2** (combat: LOS, cover, shooting, suppression, death) from
[`../docs/BUILD_PLAN.md`](../docs/BUILD_PLAN.md). It rebuilds the control model proven in
[`../slice`](../slice) on the real architecture.

## Run it

```bash
cd game
npm install
npm run dev       # dev server (Vite) — open the printed localhost URL
```

Other scripts: `npm run build` (typecheck + production build), `npm run preview`
(serve the build), `npm test` (Vitest sim tests), `npm run lint`, `npm run format`.

## Controls

| Input | Action |
|---|---|
| Click a soldier / `1`–`4` | Select |
| Left-click deck | Set an auto-pathed move order for the selected soldier |
| Shift + left-click | Append another leg (waypoint) to the path |
| Right-click / `C` | Clear the selected soldier's order |
| `Space` | Execute ↔ pause |
| Mouse wheel | Zoom · **Middle-drag** to pan |

Plan while paused, hit **Execute**, watch it play out — and note that soldiers you
didn't re-task **keep their last order** (the persistent-order model, DESIGN §4.1).
Auto-pauses the first time a hostile is spotted **and the moment one of your own goes
down**. Soldiers auto-engage visible hostiles in range; cover, range, and suppression
decide the trade, and a downed soldier bleeds out (stabilize/drag arrives in M7).

## Architecture (see `BUILD_PLAN.md` §2)

```
src/
  sim/        # deterministic, headless — NO Pixi/DOM/wall-clock/Math.random.
              #   grid · pathfinding (A*) · los · cover · combat · orders · unit · world · rng
  game/       # engine: Pixi render, pan/zoom camera, input, fixed-timestep loop
  render/     # (draw helpers live in game/engine for now; split out as they grow)
  ui/         # React "1c CONSOLE" shell + zustand store + theme tokens
  content/    # authored data — the demo deck (maps) and weapon defs (hull-safe ratings)
```

**The bet:** the simulation is a pure, deterministic module. Rendering reads it; input
produces `Order` objects it consumes. `npm test` exercises the whole sim with no
browser, and an ESLint rule bans wall-clock/`Math.random` inside `src/sim/**` to keep
saves and replays reproducible.

## What's in / not in these milestones

**In:** deck grid, A* pathfinding, fog-of-war stub, individual per-unit orders that
persist across pauses, plan-then-execute with a live path preview, pan/zoom camera, the
console UI; **combat** — line of sight, directional cover, weapons with hull-safe
ratings, armor/HP, suppression (pins movement) and stress, downs + bleed-out + death,
simple hostile AI (idle → alert → engage with a reaction delay), tracers, and auto-pause
on first contact and on a casualty. 22 deterministic sim tests.

**Not yet (later milestones):** breach & overwatch waypoints (M3), hull venting (M4),
mission objectives & defense mode (M5), the strategic layer (M6), the survivor/roster
loop with stabilize/drag (M7), the four faction AIs and detailed deck-plan art (M8+).
Enemies here are simple hold-and-engage defenders; distinct faction doctrines come in M8.
