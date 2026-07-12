# INFILTRATOR — Control Slice

A **dependency-free** proof of the core control model from `docs/DESIGN.md` §4.1:
*Door Kickers*-style **plan-then-execute**. No build step — just open the file.

## Run it

Open **`slice/index.html`** in any modern browser (double-click, or serve the folder).

## What it demonstrates

- A deck-plan grid (two rooms, a spine corridor, two breaching doors) in the game's palette.
- **Plan while paused, then execute:** select a soldier, draw a movement path with waypoints,
  press play, and watch the squad walk it in real time — the heart of the intended feel.
- A patrolling hostile and **auto-pause on contact** — the "your plan meets the unknown" beat.
- The selected "1c CONSOLE" UI shell: right sidebar roster, live status, event log.

## Controls

| Input | Action |
|---|---|
| Click a soldier / `1` / `2` | Select that soldier |
| Left-click deck | Add a movement waypoint (path stops at walls) |
| Right-click | Remove last waypoint |
| `C` / CLEAR | Clear selected soldier's path |
| `Space` / EXECUTE | Toggle execute ↔ pause |

## What it is *not*

This is a throwaway **feel test** on vanilla Canvas — no fog of war, cover, hull venting, real AI,
or the production architecture. Its only job is to de-risk whether the plan-then-execute loop is fun
before committing to the full stack. Production **M1** rebuilds this same loop on the
TypeScript + PixiJS architecture in `docs/BUILD_PLAN.md` §2.
