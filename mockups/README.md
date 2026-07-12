# INFILTRATOR

Top-down squad tactics in space — *Door Kickers* meets *Heat Signature*, with an XCOM-style
strategic layer. You command a fireteam of space soldiers who board, capture, and defend
spaceships and stations.

## Core loop

1. **Strategic layer** — a sector map where contracts (assault / defend / story) appear over
   time. Strategic clock is pausable, like the tactical one.
2. **Briefing** — sitrep, intel, rules of engagement, and entry-point selection.
3. **Loadout** — per-soldier equipment. Weapons carry a **hull-safe rating**: gauss and SAW
   fire can breach the hull and vent compartments.
4. **Tactical mission** — pausable real-time, top-down deck plans, squads of up to 12.
   - **Assault**: fight through to the bridge and take the helm.
   - **Defense**: enemies can cut through the hull *anywhere* on the perimeter. During a
     timed prep phase you place a limited stockpile — deployable cover, AP mines, sentry
     guns, door sealers — to funnel attackers into kill zones. Stockpile depends on squad
     loadout; unused prep time banks as a sensor bonus.
5. **Barracks** — promote and specialize soldiers between missions (branching specs,
   permanent choices).

## The mockup

Open **`Infiltrator Mockups.dc.html`** in a browser (keep `support.js` next to it).
It's a pan/zoom canvas, newest work at the top:

- **3a** — Defense mission, prep phase: hull-cutting warnings, placement mode, kill-zone funnel
- **2a–2d** — Campaign flow in the chosen art direction: strategic map, briefing, loadout, barracks
- **1a–1c** — Three art/UI directions for the tactical screen (1c "CONSOLE" was selected)

## Design direction

- **1c CONSOLE**: persistent right sidebar (roster / selected unit / event log), top command
  bar, deck-plan map. Scales to 12-soldier squads.
- Gritty mil-sim tone: dark navy (`#05080d`), cyan (`#3fd0f0`) friendly / UI, orange-red
  (`#ff8b3d` / `#ff5c33`) threat and alerts.
- Type: Rajdhani (display) + IBM Plex Mono (data).

## Status

UI mockups only — no gameplay code yet.
