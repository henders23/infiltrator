# INFILTRATOR — Build Plan

How the design in `docs/DESIGN.md` becomes a shippable game. This is the engineering roadmap:
architecture, milestones, testing strategy, risks, and a concrete definition of the first vertical
slice (a proof of which lives in `slice/`).

- **Stack:** TypeScript, **PixiJS** (WebGL 2D renderer) for the tactical viewport, **React** for the
  meta/UI shell (reuses the mockup styling), **Vite** for build/dev, **Zustand** for UI state.
- **Why web:** the mockups are already web; instant shareable playtests (a URL); zero-friction
  iteration. Desktop shipping later via **Tauri** (thin, native-feeling wrapper) — the game code
  doesn't change.
- **Non-negotiable architectural bet:** a **deterministic, headless tactical simulation** fully
  separated from rendering and UI (see §2). Everything else depends on getting this right.

---

## 1. Design principles for the codebase

1. **Sim / render / UI separation.** The simulation is pure TypeScript with no DOM, no Pixi, no
   `Math.random`. Rendering reads sim state; UI dispatches intents. You can run the sim in a test
   with no browser.
2. **Determinism.** Fixed timestep, seeded RNG, integer/fixed-point where it matters. Same seed +
   same orders ⇒ same outcome, every time. This is what makes plan-then-execute, pause/resume,
   save/load, replays, and reproducible bug reports all *free* instead of nightmares.
3. **Data-driven content.** Weapons, enemies, factions, specs, and maps are data (TS/JSON), not code.
   Designers (you) tune numbers without touching systems. Enables procedural generation later.
4. **Command pattern for orders.** Player intent → immutable `Order` objects on a per-unit queue. The
   sim consumes orders on tick. This *is* the plan-then-execute model, and it serializes trivially.
5. **Thin vertical slices.** Every milestone ends in something you can *play and feel*, not a
   subsystem in a vacuum.

---

## 2. Architecture

```
src/
  sim/            # deterministic, headless. NO Pixi, NO DOM, NO Math.random.
    grid.ts       #   deck-plan tilemap, tiles, walls, doors, hull cells
    pathfinding.ts#   A* + path smoothing on the grid
    los.ts        #   line of sight / visibility / fog
    rng.ts        #   seeded PRNG (mulberry32/xorshift)
    unit.ts       #   unit state: stats, hp, armor, stance, status
    orders.ts     #   Order types (Move, Breach, Overwatch, UseItem, Plant, Drag…)
    combat.ts     #   shooting, cover, suppression, damage, morale
    hull.ts       #   breaches, decompression, pressure, bulkhead sealing
    ai/           #   enemy behaviors (per-faction doctrines)
    world.ts      #   the tactical world; step(dt) advances one fixed tick
    events.ts     #   sim → outside event stream (shot, hit, down, breach, vent…)
  render/         # PixiJS. Reads sim state + event stream, draws. Owns nothing authoritative.
    viewport.ts   #   pan/zoom camera over the deck plan
    deckRenderer  #   tiles, walls, doors, hull, fog
    unitRenderer  #   soldiers/enemies, facings, health
    planRenderer  #   path lines, waypoints, kill-zone/overwatch cones (the DK planning UI)
    fx.ts         #   muzzle flashes, decompression, breach VFX
  game/           # strategic + campaign layer (its own state machine)
    campaign.ts   #   sector map, contract generation, strategic clock
    factions.ts   #   4 factions: standing, contract pools, doctrines
    roster.ts     #   soldiers, XP, specs, injuries, permadeath, bonds, stress
    economy.ts    #   pay, upkeep, salvage, recruitment
    ship.ts       #   cutter upgrades (infirmary/armory/training/…)
    save.ts       #   serialization (sim is deterministic ⇒ save = seed + orders + state)
  ui/             # React shell in the "1c CONSOLE" layout. Reuses mockup tokens.
    tactical/     #   command bar, right sidebar (roster/unit/log), mission HUD
    strategic/    #   sector map, briefing, loadout, barracks screens
    theme.ts      #   color tokens (#05080d/#3fd0f0/#ff8b3d…), Rajdhani + IBM Plex Mono
    store.ts      #   Zustand store bridging UI ↔ sim/game
  content/        # DATA. Tuned by design, not engineers.
    weapons.ts    #   incl. hull-safe ratings
    enemies.ts    #   per-faction unit defs
    specs.ts      #   class/spec trees
    maps/         #   authored deck plans + procedural-gen params
    factions.ts   #   faction fiction + tuning
  main.ts         # boot, wiring, game loop
```

**The game loop.** A fixed-timestep accumulator drives `sim.world.step(dt)` at, say, 30 Hz;
rendering interpolates at display rate. "Pause" simply stops feeding ticks — orders can still be
edited while paused, which is exactly the plan-then-execute loop. No sim logic ever runs in a render
or React frame.

---

## 3. Milestones

Each milestone is a playable increment. Rough sizing is relative effort (S/M/L/XL), not calendar —
adjust to your available time. **M0–M1 is what the `slice/` prototype foreshadows.**

### M0 — Scaffold & foundations  · S
- Vite + TS + Pixi + React project; lint/format/test (Vitest); theme tokens from the mockup.
- Deterministic clock, seeded RNG, fixed-timestep loop, pause. Empty deck renders; camera pan/zoom.
- **Playable:** an empty ship deck you can pan around. Proves the render/sim boundary.

### M1 — Tactical core: plan-then-execute movement  · M  ← *vertical slice target*
- Grid deck with walls; A* pathfinding; fog of war stub.
- Select a soldier → draw/auto path → queue → **execute** → soldier walks it → **pause** anytime.
- Multiple soldiers, per-unit order queues, synchronized "go".
- **Playable:** move a squad room-to-room by planning and executing. *This is the core feel.*
  (`slice/index.html` is a dependency-free proof of exactly this.)

### M2 — Combat: LOS, cover, shooting, death  · L
- Directional cover, line-of-sight visibility, weapon fire, armor/HP, suppression, downs/death.
- One simple enemy that shoots back. Auto-pause-on-contact.
- **Playable:** a real, lethal firefight you win or lose by positioning.

### M3 — Orders depth & entries  · L
- Action waypoints: **breach door**, frag/flash-through, stack-up, **overwatch** (facing cones),
  use item, drag downed ally. Quiet vs loud entry; stances.
- **Playable:** the two-door synchronized breach — the signature DK1 moment.

### M4 — Hull & venting  · L
- Hull cells, breachable walls, hull-safe weapon ratings, breach charges/cutters.
- Explosive decompression (pull/knockdown/spacing), pressure, auto-bulkheads, sealers, suits.
- **Playable:** win a room you couldn't take by venting it — and learn to fear doing it.

### M5 — Mission types & objectives  · L
- Assault (reach bridge, channel the helm), Defense (prep phase + stockpile placement + kill zones +
  banked-sensor bonus + attack waves), Rescue, Sabotage. Win/lose/extract flow.
- **Playable:** full missions start-to-extraction, both assault and defense.

### M6 — Strategic layer  · L
- Sector map, pausable strategic clock, contract generation from 4 factions, reputation/standing,
  economy (pay/upkeep/salvage), cutter hub + upgrade slots, briefing → mission → debrief loop.
- **Playable:** a short campaign of chained contracts with money pressure and faction choices.

### M7 — Roster & the survivor loop  · L
- Recruitment/hiring pool, XP/rank, permanent spec trees, **persistent injuries + infirmary**,
  **permadeath**, drag-to-extract stakes, stress/morale, bonds, reserve + payroll.
- **Playable:** Battle-Brothers-style attrition — named people, real loss, triage decisions.

### M8 — Faction AI & content depth  · XL
- Four distinct enemy doctrines (Blackline overwatch-web, Combine systems/alarms, Drift hull-cutting
  chaos, Sodality fearless network), signature units, hackable systems, reinforcement/escalation AI.
- Authored + **procedurally generated** deck plans; content pass on weapons/gear/specs.
- **Playable:** each faction *feels* different to fight and demands different counters.

### M9 — Campaign, escalation & meta  · L
- Story missions and faction arcs; the **Sodality escalation clock** and its endgame crisis; win/loss
  conditions; difficulty modes (up to Ironman + permadeath + hard economy); save/load; onboarding.
- **Playable:** a full campaign with an arc and an ending shaped by your choices.

### M10 — Balance, polish, ship  · L
- Economy/attrition/difficulty tuning via playtest telemetry; audio pass; VFX/juice; performance
  (12v-many units, big decks); accessibility (auto-pause tiers, colorblind-safe faction accents);
  Tauri desktop build.
- **Playable:** the game.

**Suggested first-playable order to get to fun fastest:** M0 → M1 → M2 → M3 → M5(assault only) →
M7(minimal) → M6(minimal). That chain gives a lethal, planned boarding action with soldiers who can
permanently die and a thread of campaign around it — the emotional core — before you invest in the
full four-faction content and the hull-physics and defense-mode depth.

---

## 4. Testing & quality strategy

Determinism makes testing unusually tractable — lean into it:

- **Unit tests (Vitest)** for pure sim modules: pathfinding, LOS, cover math, damage/armor, hull
  decompression, morale.
- **Deterministic scenario/replay tests:** encode `(map, seed, ordered player commands)` → assert
  final world state or a golden event log. Catches regressions in the whole sim at once; doubles as
  reproducible bug reports.
- **AI harness:** run enemy doctrines headless against fixed scenarios to catch dumb/loopy behavior.
- **Balance sims:** batch-run missions headless with scripted play to sanity-check attrition/economy
  curves before human playtests.
- **Golden-master** for the strategic RNG (contract/recruit generation) so tuning changes are visible.

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Determinism leaks (floats, `Date.now`, `Math.random`) break replays/saves | High | Seeded RNG only; fixed timestep; lint rule banning `Math.random`/`Date.now` in `sim/`; replay tests in CI. |
| Plan-then-execute control feels clunky/fiddly | High | Prototype the *feel* first (done in `slice/`); iterate on path/waypoint UX before building depth on top. |
| Scope explosion (4 factions × many systems) | High | Milestones each ship playable; build ONE faction (Blackline) fully in M2–M5, template the other three in M8. |
| Hull/venting physics is fun in theory, chaotic in practice | Med | Contain to grid-based, readable rules (pull toward breach for N ticks); telegraph heavily; make it a deliberate tactic, not random. |
| Attrition economy too punishing or too soft | Med | Difficulty toggles + headless balance sims; tune upkeep/recruit costs late (M10). |
| Perf with 12 friendlies + many enemies + fog + VFX | Med | Pixi batching; spatial partitioning for LOS; cap sim tick rate; profile early. |
| UI complexity (12-unit console) | Med | Reuse the validated "1c CONSOLE" layout; build the sidebar/command-bar shell early against real sim state. |

---

## 6. The vertical slice (`slice/`)

**Goal:** de-risk the single most important thing — *does the plan-then-execute control model feel
good?* — before committing to the full stack.

`slice/index.html` is a **dependency-free, single-file** Canvas prototype (open it in a browser, no
build step) that implements the M1 core in miniature:

- A deck-plan grid with walls and a door, in the mockup's palette.
- Two selectable soldiers; click to lay down a movement path with waypoints; clear/replan.
- **Plan while paused → press play → soldiers walk their paths in real time → pause anytime.**
- A patrolling enemy and a "contact" auto-pause, to feel how planning meets the unknown.

It intentionally uses vanilla Canvas (not Pixi) so it runs instantly and is disposable — it's a
*feel test*, not production code. The production M1 rebuilds the same loop on the architecture in §2.
See `slice/README.md` for controls.

---

## 7. Immediate next steps

1. **Play the slice** (`slice/index.html`) and react to the control feel — this steers M1's UX.
2. Approve/adjust the design (`docs/DESIGN.md`) — especially the four factions and the survivor loop.
3. On approval, execute **M0** (scaffold Vite+TS+Pixi+React with the theme tokens and the
   deterministic loop) and **M1** (production plan-then-execute) — the slice becomes the spec.
