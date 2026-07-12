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
| **`docs/DESIGN.md`** | Full game design doc — story, the **four factions**, tactical & hull-venting systems, the survivor/roster loop, strategic layer, difficulty. |
| **`docs/BUILD_PLAN.md`** | Engineering roadmap — tech stack, architecture, **M0–M10 milestones**, testing, risks, first vertical slice. |
| **`slice/`** | A **playable, dependency-free** proof of the plan-then-execute control model. Open `slice/index.html`. |
| **`mockups/`** | The original design brief + UI mockups (the "1c CONSOLE" direction) that set the visual language. |

## Start here

1. **Play the slice** — open `slice/index.html`, plan a squad's entry, and hit execute. This is the
   core feel the whole game is built around.
2. **Read `docs/DESIGN.md`** — especially §3 (the four factions) and §5 (the survivor loop).
3. **Read `docs/BUILD_PLAN.md`** — the milestone plan for turning the design into a shippable game.

## The one-paragraph pitch

Four powers — the last loyalist navy (**Blackline**), a predatory megacorp (**the Combine**),
hull-cutting salvage pirates (**the Drift**), and a fearless transhuman cult rising in the dark
(**the Sodality**) — carve up a dead cluster where the only wealth is intact ships. You command a
cutter and a squad of expendable soldiers, boarding hulls room by room. Every entry is a puzzle you
solve by planning; every plan meets something you didn't know; and every mission spends people you've
come to know by name. The hull itself is a loaded weapon — breach it and vacuum kills both sides.
Survive the contract treadmill long enough to keep a few veterans alive, and you might still be
standing when the Choir finally sings.

*Status: design + build plan complete; playable control slice; production code not yet started.*
