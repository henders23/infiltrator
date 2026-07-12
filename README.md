# INFILTRATOR

Top-down squad tactics in space. **Plan-then-execute boarding actions** (*Door Kickers*) fought with
**cheap, mortal soldiers** whose losses accumulate into a campaign (*Battle Brothers* survivor
attrition), wrapped in an **XCOM-style strategic layer**. You are a Marine boarding officer selling
violence to four warring powers in a collapsed star cluster.

> Board, capture, and defend spaceships. Vent the hulls you can't take. Bury the men you can't save.
> Keep the contracts coming before payroll — or the Choir — catches up with you.

## Where things are

| Path | What it is |
|---|---|
| **`game/`** | The **playable game** (TypeScript + PixiJS + React). Implements build-plan **M0–M4**: plan-then-execute movement, combat (LOS, cover, suppression, death), entries (breach doors, flash/frag, overwatch), and hull venting (decompression, pressure, suits). `cd game && npm install && npm run dev`. |
| **`docs/DESIGN.md`** | Full game design doc — story, the **four factions**, tactical & hull-venting systems, the survivor/roster loop, strategic layer, difficulty. |
| **`docs/BUILD_PLAN.md`** | Engineering roadmap — tech stack, architecture, **M0–M10 milestones**, testing, risks. |
| **`slice/`** | A **dependency-free** proof of the plan-then-execute control model (no build step). Open `slice/index.html`. |
| **`mockups/`** | The original design brief + UI mockups (the "1c CONSOLE" direction) that set the visual language. |

## Start here

1. **Run the game** — `cd game && npm install && npm run dev`. Select a soldier, set a path, hit
   Execute. Soldiers you don't re-task hold their last order (persistent orders). (No toolchain? The
   `slice/index.html` shows the same core loop with zero setup.)
2. **Read `docs/DESIGN.md`** — especially §3 (the four factions) and §5 (the survivor loop).
3. **Read `docs/BUILD_PLAN.md`** — the milestone plan; M0–M4 are done (`game/`), M5 (mission objectives & defense) is next.

## The one-paragraph pitch

Four powers — the last loyalist navy (**Blackline**), a predatory megacorp (**the Combine**),
hull-cutting salvage pirates (**the Drift**), and a fearless transhuman cult rising in the dark
(**the Sodality**) — carve up a dead cluster where the only wealth is intact ships. You command a
cutter and a squad of expendable soldiers, boarding hulls room by room. Every entry is a puzzle you
solve by planning; every plan meets something you didn't know; and every mission spends people you've
come to know by name. The hull itself is a loaded weapon — breach it and vacuum kills both sides.
Survive the contract treadmill long enough to keep a few veterans alive, and you might still be
standing when the Choir finally sings.

*Status: design + build plan complete; playable control slice; production build at M0–M4 (plan-then-execute
movement, combat, breach/flash/overwatch entries, and hull venting) in `game/`. Next: M5 — mission objectives & defense mode.*
