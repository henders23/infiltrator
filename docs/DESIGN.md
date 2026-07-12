# INFILTRATOR — Game Design Document

> Top-down squad tactics in space. *Door Kickers* (plan-then-execute) meets *Battle Brothers*
> (survivor attrition) meets an XCOM-style strategic layer. You are a Marine boarding officer
> in a collapsed star cluster, running contracts for four warring powers with a squad of
> soldiers who are cheap, replaceable, and mortal.

- **Genre:** Real-time-with-pause tactics + roster management + strategic campaign
- **Camera:** Top-down, 2D deck plans
- **Tone:** Gritty, grounded hard-sci-fi mil-sim. Not heroic. Attrition is the story.
- **Platform:** Web (TypeScript + PixiJS), desktop-shippable later via wrapper
- **Pillars:**
  1. **Every entry is a puzzle.** No intel, breachable doors, killer angles. Planning wins fights.
  2. **Soldiers are ammunition; the officer is the campaign.** Men die by the fistful. You persist.
  3. **The ship is a weapon that can turn on you.** Hull venting kills both sides — use it, fear it.
  4. **Four powers, four pressures.** Every contract you take is a knife in someone else's back.

---

## 1. Fantasy & framing

You play **the Officer** — a boarding commander who owns a cutter (a fast, cramped assault ship)
and a contract license. You are the persistent identity across the whole campaign: your name, your
reputation, your traits, your ship. Everyone under you is expendable.

Your soldiers — "**deckhands**" in the barracks slang — are cannon fodder in the literal sense:
recruited cheap from refugee holds and prison hulks, thrown at hulls, and buried (or left floating)
in numbers. A hard mission can cost you half a squad. That is normal. The drama is not "will my hero
survive" — it's "which of these named, scarred, half-trained people do I spend to make the objective,
and can I afford to replace them before the next contract clock runs out."

This is the **Battle Brothers survivor loop** transplanted into space:

- Soldiers are individuals with names, stats, traits, and a face. You get attached anyway.
- Death is permanent and cheap. Injury is persistent and expensive.
- The roster is a bathtub: recruits pour in the top, corpses drain out the bottom, and your job is to
  keep enough *veterans* alive long enough to matter — because a veteran is worth ten recruits, and
  the game constantly tempts you to spend them.

---

## 2. The setting — the Tannhäuser Reach

A star cluster on the far edge of settled space. Forty years ago the **Concord Directorate** — the
central government and navy that held the shipping lanes — collapsed. Its fleets fragmented, its
stations went dark or feral, and the Reach became a graveyard of drifting hulls and contested lanes.
Nobody rebuilds ships out here; they *board* them, gut them, and re-crew them. Hulls are the only real
wealth. Boarding is the only real war.

You are one of hundreds of licensed **cutter captains** selling violence to whoever pays. The four
powers below are your employers *and* your enemies — you fight one faction's soldiers on Monday and
take that same faction's contract on Friday. Reputation is a currency you spend by choosing sides.

---

## 3. The four factions

Each faction is designed to be **three things at once**: a distinct employer (what contracts they
offer, how they pay, what they demand), a distinct enemy (a tactical AI profile you must counter),
and a distinct strategic pressure (how their rise or fall reshapes the sector). They are grounded —
no space wizards — but each has one strong mechanical identity.

### 3.1 The Directorate Remnant — "Blackline"
*Steel white / navy. The old order, refusing to die.*

- **Identity:** Survivors of the Concord's officer corps and marine regiments. Disciplined,
  doctrinaire, and convinced they are the only legitimate authority left. They want the Reach
  reunified under them — and they take it hull by hull.
- **As employer:** Pay in stable scrip and legal cover (fewer strategic consequences). Demand clean
  work — **hull-preservation clauses**: vent an objective ship and you forfeit the bonus. Offer the
  best late-game gear if you stay loyal.
- **As enemy — doctrine "Hold the Line":** The hardest *conventional* fight. Coordinated fireteams
  that bound and cover, breach discipline, deployable sentry drones, and **overwatch webs** — they
  punish sloppy movement. Heavy armor; you need AP or flanking. They almost never breach their own
  hull, so venting is *your* trump card against them.
- **Signature units:** Line Marine (armored rifle), Bulwark (shield + heavy armor, anchors a room),
  Sentry Drone (auto-turret you can hack or destroy), Sergeant (buffs nearby morale, calls reinforcements).
- **Counter-play:** Flank the overwatch web; vent the room you can't take.

### 3.2 The Halcyon Combine — "The Combine"
*Amber / gold. Capital with a security division.*

- **Identity:** A megacorp cartel that treats the Reach as inventory. Indentured labor, salvage
  monopolies, and a private security arm. People are assets; assets are line items; line items get
  written off.
- **As employer:** Pay the *most*, in hard credits — but contracts come with strings: reclaim "their"
  ship (that they may not legally own), erase witnesses, retrieve data cores. High pay, dirty rep.
- **As enemy — doctrine "Asset Denial":** A **systems** fight, not a soldier fight. Automated turrets,
  locked/hackable doors, security bots, gas and lockdown countermeasures, and camera-linked alarms
  that escalate the whole map if you're loud. Their human security is cheap conscripts stiffened by a
  few elite **Halcyon Operators**. Kill the network, the map goes quiet.
- **Signature units:** Conscript Guard (weak, numerous), Auto-Turret (ceiling-mounted, hackable),
  Security Bot (armored drone), Halcyon Operator (elite, cloaking, executes wounded), Warden (control
  node — killing it drops the automated defenses).
- **Counter-play:** Bring a hacker/breacher; go quiet or go fast before the alarm tree escalates.

### 3.3 The Drift Clans — "Scrap-born"
*Rust / orange-red — the threat color.* 

- **Identity:** Breakaway colonists, pirates, and salvage clans who live *inside* the wreck-fields.
  They don't fear the vacuum — they weaponize it. To a Drift boarding party, your hull integrity is
  just another thing to take away from you.
- **As employer:** Pay in salvage rights, contraband gear (illegal hull-breaching weapons, the
  best gauss and SAWs), and information. Chaotic, unreliable, but they'll sell you tools nobody else
  will.
- **As enemy — doctrine "Open the Hull":** The **aggression and chaos** fight. Fast, reckless melee
  and shotgun rushers, improvised armor, and — uniquely — they will **cut through your hull anywhere**
  and **vent compartments on purpose** to scatter and kill your squad. They breach from unexpected
  vectors. In defense missions, *they* are the attackers who come through the walls.
- **Signature units:** Reaver (shotgun/melee rusher), Cutter (drills hull breaches to open new
  vectors), Scrap-gunner (SAW, sprays and breaches), Chief (berserk buff), Limpet Mine (they seed the
  hull).
- **Counter-play:** Door discipline and sealers; deny them the chaos of an open hull; hold tight
  interlocking rooms instead of open decks.

### 3.4 The Sodality — "The Choir"
*Violet / cold white. The thing that grows while everyone else fights.*

- **Identity:** A transhumanist compact of augmented true-believers who see the collapse as a
  cleansing. They don't recruit; they *convert*. Early game they're a rumor. Late game they are the
  reason the sector is dying. They are the campaign's escalation clock made flesh.
- **As employer:** Rarely, and it costs you. Their contracts pay in forbidden augmentation (powerful
  soldier upgrades with permanent downsides) and pull your officer down a dark reputation path.
- **As enemy — doctrine "The Choir Sings":** The **morale and durability** fight. Augmented soldiers
  who are **immune to fear/suppression**, move in eerie synchrony, share a network so killing one can
  ripple, and shrug off hits that drop a normal man. They break the emotional economy of the game:
  your squad's morale means nothing to them, and their calm terrifies your squad.
- **Signature units:** Acolyte (augmented, fearless line unit), Vessel (heavy, regenerates),
  Cantor (network node — buffs and rezzes nearby Sodality; kill priority), Chosen (elite miniboss).
- **Counter-play:** Alpha-strike the Cantors, bring overwhelming AP, accept that attrition trades are
  the only way through — this is where your veterans die.

**Faction interplay (strategic).** The Directorate, Combine, and Drift are a three-way cold war you
can tilt. The Sodality rises independently on a hidden clock; ignoring it (chasing easy Combine money)
lets it metastasize until it's eating the whole map. The endgame is shaped by which of the three
"human" powers you've propped up when the Choir finally sings.

---

## 4. Core gameplay — the tactical mission (Door Kickers, plan-then-execute)

The heart of the game. A single boarding action on one ship or station, top-down, on a deck-plan grid.

### 4.1 The control model — DK1 plan-then-execute
Real-time-with-pause. At any moment you **pause** (the default planning state), issue orders, then
**execute** (unpause) and watch it play out. Orders are **paths with action waypoints**:

- Select a soldier, draw a movement path tile-by-tile (or click a destination for auto-path via A*).
- Drop **action waypoints** along the path: *breach door*, *frag/flash through door*, *stack up*,
  *hold/overwatch facing a direction*, *use item*, *plant charge*, *revive/drag ally*.
- Set a **stance** per leg: move (fast, loud, exposed) vs advance (slow, weapon up, reacts faster).
- Queue all soldiers, then hit go. Time flows; you re-pause the instant contact or a plan breaks down.
- **Snap-pause options** (accessibility/difficulty): auto-pause on enemy spotted, on soldier down, on
  waypoint reached. Ironman disables generous auto-pause.

**Individual planning + persistent orders (the key to commanding a dozen soldiers).** You plan each
soldier individually — no forced fireteam grouping. What keeps that from becoming twelve-orders-per-
pause busywork is that **orders and postures persist**: a soldier holds its last standing order until
you change it. A man told to *overwatch this door* keeps watching it through every subsequent pause; a
man mid-path keeps walking it; a man in *hold cover* stays put. So on a typical re-pause you touch only
the two or three units whose situation actually changed and let the rest **remain postured as ordered**.

- **Standing orders** a soldier holds until re-tasked: *hold position (facing)*, *overwatch (arc)*,
  *guard/cover a point*, *follow ally*, *continue current path*, *hold fire / weapons free*.
- The command bar surfaces **who needs attention** (contact, path complete, downed, panicking) so you
  can find the units worth re-planning without scrubbing the whole roster.
- Optional convenience later (not required for the core): save a stack of soldiers as an ad-hoc group
  to issue a shared waypoint — but the atomic unit of command stays the individual.

This is the *Door Kickers 1* fantasy: the joy is the **plan** — synchronizing a two-door breach so
both rooms are flashed and cleared in the same second — and the horror is watching a good plan meet a
detail you didn't know about. Persistent postures are what let that scale from a 4-stack to a
12-soldier boarding action without drowning you in micromanagement.

### 4.2 Information & stealth
- **No intel by default.** You don't see through walls or doors. Fog of war is hard.
- Doors can be **peeked, opened quietly, or breached loud**. Quiet entry preserves surprise; loud
  entry (breach charge, kicking, gunfire) alerts the deck and starts escalation timers.
- **Cameras/alarms (Combine)** and **patrol routes** reward reconnaissance-by-movement.
- Suppressed weapons and melee enable a stealth clear; going loud is sometimes correct (speed).

### 4.3 Combat model
- **Line of sight + cover.** Cover is directional; corners and doorframes matter. Overwatch fires on
  movement through a facing arc.
- **Suppression & morale.** Under fire, most soldiers' aim degrades and they can panic (freeze, flee,
  break cover) — driven by the **stress** stat. Sodality units ignore this; that's the point.
- **Weapons & the hull-safe rating (signature system).** Every weapon has a **hull-safe rating**:
  - *Hull-safe* (flechette, shotgun, sidearms, blades): won't breach a hull.
  - *Hull-risk* (rifles/carbines on full auto): stray rounds can crack a bulkhead over time.
  - *Hull-breaching* (**gauss**, **SAW**, breach charges, cutters): reliably punch the hull.
  - So your loadout is a **risk budget**: gauss deletes an armored Bulwark but might vent the very
    compartment you're standing in — and the objective you were paid to preserve.
- **Armor** soaks damage and demands AP or angles. **HP** is small; a soldier out of cover in the
  open dies fast. This is not a bullet-sponge game.

### 4.4 The hull & venting system (signature)
Ships are pressurized. **Breaching the hull** — by your gauss/SAW/charges, or by the Drift cutting in —
opens a compartment to vacuum:

- **Explosive decompression** pulls unsecured units and objects toward the breach for a few seconds:
  knockdown, damage, and possible spacing (instant death) for anyone caught in the open near it.
- Vented compartments are **lethal without a suit**; the pressure gradient can slam or seal doors.
- **Consequences everywhere:** venting the room you can't take is a legitimate, brutal tactic. Venting
  the *objective* ship fails Directorate hull-preservation clauses. The Drift will vent *you*.
- **Emergency bulkheads** auto-seal (slowly) to contain a breach; **door sealers** and **suits** are
  the counters. This turns the map itself into a weapon with a safety catch.

### 4.5 Mission types
- **Assault:** Fight through to the **bridge** and **take the helm** (a channel/timer on the helm
  console) to capture the ship. Optional objectives: prisoners, data cores, minimizing hull damage.
- **Defense:** *Your* held ship/station under boarding. A **timed prep phase** lets you place a limited
  **stockpile** — deployable cover, AP mines, sentry guns, door sealers — to build **kill zones** and
  funnel attackers (esp. Drift, who breach the perimeter *anywhere*). Unused prep time **banks as a
  sensor bonus** (early warning of breach points). Then survive the assault waves.
- **Rescue / extract:** Reach and escort a target (POW, VIP, defector) back to your entry point alive.
- **Sabotage / raid:** Plant charges, steal a core, assassinate a node (Warden/Cantor), then exfil
  before reinforcements or a scuttle timer.
- **Story missions:** Hand-authored set-pieces that advance the campaign and faction arcs.

---

## 5. The roster — survivor attrition (Battle Brothers)

The meta-game that gives the tactics weight. Managed from the **Barracks** aboard your cutter.

### 5.1 Soldiers as individuals
Each soldier has: name, portrait, **background** (refugee, ex-Directorate, convict, salvager, etc.
— sets starting stats and a hidden trait bias), core stats, level/rank, a class/spec tree, gear, and
a growing list of **traits** (permanent quirks: good and bad).

- **Core stats:** Aim, Reflex (overwatch/reaction speed), Nerve (stress resistance/morale),
  Fortitude (HP/wound resistance), Tech (hacking/breaching/medical), Move.
- **Backgrounds** matter like Battle Brothers: an ex-Directorate Line Marine starts strong but costs
  more and may have a "By The Book" trait; a convict is cheap, fast, and unreliable under stress.

### 5.2 Classes / specializations (branching, permanent)
On promotion, soldiers pick a branch. Choices are **permanent** (the mockup's design). Examples:
- **Breacher** — doors, charges, shotgun mastery, first-through-the-door bonuses.
- **Gunner** — SAW/gauss, suppression, hull-breaching specialist (high risk/reward).
- **Corpsman** — stabilize, drag, revive, reduce permanent-injury odds. *The reason veterans survive.*
- **Techie** — hacking (turrets, doors, cameras), sensors, drone control.
- **Marksman** — precision, overwatch webs, armor-piercing at range.
- **Point/Sergeant** — morale aura, coordination, extra order slots. A leader multiplies fodder.

### 5.3 Injury, death, and the survivor loop
This is the emotional core. When a soldier goes down in a mission:

- **Bleeding out:** a downed soldier has a timer. A Corpsman can **stabilize** and an ally can **drag**
  them to extraction — costing you tempo and exposure. Do you spend two soldiers saving one?
- **Death is permanent.** Left behind, bled out, spaced by a vent, or killed outright — gone. Their
  gear may be recoverable; they are not.
- **Persistent injuries:** survivors carry wounds that need **infirmary time** (missions) to heal.
  Some resolve into **permanent scars/traits**: lost eye (−Aim), cybernetic replacement (mixed),
  "Shell-shocked" (−Nerve), or hard-won positives like "Cold Under Fire" earned by surviving a vent.
- **Triage economy:** Because recruits are cheap and veterans are gold, every mission is a spend/keep
  decision. The game is *designed* to make you sacrifice named people you like. That's the drama.

### 5.4 Morale, bonds, and stress (campaign-level)
- Soldiers accumulate **stress** across missions; high stress → worse in-mission Nerve, quirks,
  desertion risk. **Downtime** and wins relieve it.
- **Bonds** form between soldiers who survive together (buffs when near each other) — and **grief**
  penalties when a bonded partner dies. Attachment has mechanical teeth.

### 5.5 Recruitment & the reserve
- Cheap recruits from a rotating **hiring pool** (quality varies by where you dock and your rep).
- A **reserve roster** larger than a squad; you field up to 12, rotate the wounded, and eat upkeep on
  everyone. Payroll pressure forces you to keep the roster lean and the missions coming.

---

## 6. The strategic layer (XCOM-style)

Between missions you fly the cutter around the **sector map**. A **pausable strategic clock** runs;
contracts and threats appear and *expire* over time, forcing prioritization.

- **Contracts** (assault / defend / rescue / raid / story) posted by the four factions, each with pay,
  risk, deadline, location, and **reputation consequences**. Taking a job against the Directorate
  raises Drift rep and lowers Directorate rep, etc.
- **Reputation & standing** with each faction gates gear, contract quality, and story branches, and
  can flip a faction hostile (their patrols hunt you; their ports close).
- **The cutter** is your hub: upgrade slots for **infirmary** (heal speed/injury mitigation),
  **armory** (gear crafting/repair), **training** (XP/recruit quality), **drives** (map reach),
  **sensors** (mission intel), and **medbay/cryo** (reserve capacity).
- **Economy:** contract pay + salvage vs upkeep (payroll, fuel, repairs, ammo). Perpetual pressure to
  keep working. Salvaged hulls/gear are a second income and a risk (fencing draws heat).
- **The Sodality clock (escalation):** a **hidden** doom track — never shown as a number or a bar. The
  longer the campaign runs and the more the human factions bleed each other, the stronger the Choir
  grows, surfaced only through **diegetic tells** (rumors in briefings, missing patrols, ruined stations,
  Sodality units appearing where they shouldn't) — culminating in an endgame crisis whose difficulty
  reflects the sector state you created. The dread comes from not knowing how much time you have.

---

## 7. Difficulty & "gripping and challenging"

Challenge comes from **scarcity, imperfect information, and consequence**, not stat inflation:

- **Imperfect information** (hard fog, no wall-hacks) makes every entry a real decision.
- **Lethality** (small HP, deadly open ground) punishes bad plans immediately.
- **Attrition & triage** make you spend people you care about; the campaign remembers.
- **The hull is a loaded gun** pointed at both sides — mastery is knowing when to fire it.
- **Escalation** (alarms, reinforcements, the Sodality clock) means dithering loses.
- **Difficulty modes:** from a forgiving campaign (generous auto-pause, revivable downs, save-scum) up
  to **Ironman + Permadeath + hard economy**, where a bad Tuesday ends a run. Modular toggles so
  players tune their own pain.

---

## 8. Art, UI & audio direction (from the mockups)

- **Selected direction "1c CONSOLE":** persistent right sidebar (roster / selected-unit / event log),
  top command bar, deck-plan viewport. Scales cleanly to 12-soldier squads.
- **Detailed ship-plan overlays (the map target).** The long-term visual goal is full, readable
  **deck-plan art for whole ships and stations** — the *Door Kickers* deck-schematic look, in space:
  hull outlines, compartment walls and bulkheads, doors and airlocks, consoles, cover, and the helm,
  all as a legible top-down schematic overlay you plan on top of. Fog of war reveals it compartment by
  compartment as the squad advances. Starts as authored decks; procedural generation (§ build plan)
  extends it to varied hulls. The tactical grid underneath stays the same — this is a rendering/content
  layer, so the sim is built grid-first and the detailed overlay art is layered on without changing it.
- **Palette (already defined):** dark navy `#05080d`; cyan `#3fd0f0` (friendly/UI);
  orange-red `#ff8b3d` / `#ff5c33` (threat/alerts). Faction accents extend this (steel, amber, rust,
  violet).
- **Type:** Rajdhani (display) + IBM Plex Mono (data).
- **Audio (planned):** sparse, tense ambience; punchy diegetic weapon/breach/decompression SFX; a
  rising drone tied to the escalation clock. Silence-into-violence pacing.

---

## 9. What already exists (assets in `mockups/`)

- **`Infiltrator Mockups.dc.html`** — pan/zoom design canvas: tactical-screen art directions (1a–1c,
  1c selected), campaign flow (strategic map, briefing, loadout, barracks), and a defense prep-phase
  screen (hull-cutting warnings, placement mode, kill-zone funnel).
- These define the visual language the build reuses (color tokens, type, layout). No gameplay code yet.

See **`docs/BUILD_PLAN.md`** for how this design becomes a shippable game, and **`slice/`** for a
playable proof of the plan-then-execute control model.
