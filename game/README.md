# INFILTRATOR — game (M0–M3)

The production build of INFILTRATOR. This directory implements **M0** (scaffold +
deterministic loop), **M1** (plan-then-execute movement with persistent orders),
**M2** (combat: LOS, cover, shooting, suppression, death), and **M3** (entries: breachable
doors, flash/frag grenades, overwatch, hold-fire, noise) from
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
| Click a soldier / `1`–`4` | Select · `Tab` cycles soldiers needing orders |
| Left-click deck | Auto-pathed move for the selected soldier |
| Shift + left-click | Append another leg (waypoint) to the plan |
| `B` then click a door | **Breach** it (loud, stuns the room beyond) |
| `F` / `G` then click a tile | Throw a **flashbang** / **frag** grenade there |
| `O` then click | Set **overwatch** on that arc (fires only within the cone) |
| `H` | Toggle **hold-fire / weapons-free** for the selected soldier |
| Right-click / `C` | Clear the selected soldier's order |
| `Space` | Execute ↔ pause · Wheel zoom · **Middle-drag** pan |

Plan while paused, hit **Execute**, watch it play out — soldiers you didn't re-task **keep
their last order** (persistent orders, DESIGN §4.1). Chain waypoints for the signature
entry: **stack → flash → breach → clear.** Closed doors block movement and sight until
opened (quietly by walking through, or loudly by breaching — which stuns those beyond but
makes noise that wakes nearby defenders). Auto-pauses on first contact and on a casualty.

## Architecture (see `BUILD_PLAN.md` §2)

```
src/
  sim/        # deterministic, headless — NO Pixi/DOM/wall-clock/Math.random.
              #   grid · pathfinding (A*) · los · cover · combat · orders (plans) · unit · world · rng
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
hostile AI (idle → alert → engage with a reaction delay), tracers; **entries** —
breachable doors that block move + sight, quiet-open vs loud breach (stuns the room),
flash/frag grenades, overwatch arcs with reaction fire, hold-fire, noise that wakes
defenders, a waypoint order-mode palette and a needs-attention selector; auto-pause on
first contact and on a casualty. **29 deterministic sim tests.**

**Not yet (later milestones):** hull venting (M4), mission objectives & defense mode
(M5), the strategic layer (M6), the survivor/roster loop with stabilize/drag (M7), the
four faction AIs and detailed deck-plan art (M8+). Enemies here are simple hold-and-engage
defenders; distinct faction doctrines come in M8. Fog is still a radius stub (LOS-gated
fog is a later refinement) — combat sight already respects walls and closed doors.
