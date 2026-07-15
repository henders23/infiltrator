// The engine owns everything NON-deterministic: Pixi rendering, the pan/zoom
// camera, pointer input, and the fixed-timestep game loop. It drives the pure sim
// in sim/ and never lets rendering mutate authoritative state. "Pause" simply stops
// feeding ticks to the sim — orders can still be edited while paused, which *is* the
// plan-then-execute loop (DESIGN §4.1).

import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import soldiersUrl from '../assets/soldiers.png';
import deckUrl from '../assets/ship-deck.jpg';
import { DOOR, SPACE, WALL } from '../sim/grid';
import { findPath, Point, smoothPath } from '../sim/pathfinding';
import {
  BREACH_TIME,
  currentStep,
  FacingWaypoint,
  GrenadeType,
  GRENADE_FUSE,
  holdOrder,
  HULLCHARGE_TIME,
  isPlanComplete,
  moveStep,
  Step,
  Vec,
} from '../sim/orders';
import { isActive, isStunned, Unit } from '../sim/unit';
import { World, REVEAL_RADIUS } from '../sim/world';
import { Mission } from '../content/maps';
import { weaponOf } from '../content/weapons';
import { COLORS, FONT_MONO } from '../ui/theme';

const TILE_PX = 28;
const FIXED_DT = 1 / 60; // deterministic sim step
const EMIT_INTERVAL = 0.1; // throttle UI snapshots to ~10 Hz

/** What the next left-click on the deck means for the selected soldier. */
export type OrderMode = 'move' | 'breach' | 'flash' | 'frag' | 'overwatch' | 'vent';

// top-down soldier sprite sheet: 9 columns × 4 rows of 36 troopers, each aiming "up"
const SHEET_COLS = 9;
const SHEET_ROWS = 4;
const SHEET_W = 1536;
const SHEET_H = 1024;
const CELL_W = SHEET_W / SHEET_COLS;
const CELL_H = SHEET_H / SHEET_ROWS;

export interface UnitSnapshot {
  id: number;
  name: string;
  faction: 'friendly' | 'hostile';
  hp: number;
  maxHp: number;
  alive: boolean;
  downed: boolean;
  status: string;
  needsAttention: boolean;
  visible: boolean;
  stress: number;
  stunned: boolean;
  weaponsFree: boolean;
  suit: boolean;
  inVacuum: boolean;
  weapon: string;
  hullSafety: string;
  armor: number;
}

export interface Snapshot {
  paused: boolean;
  time: number;
  missionName: string;
  selectedId: number | null;
  orderMode: OrderMode;
  attentionCount: number;
  units: UnitSnapshot[];
  log: string[];
}

interface UnitView {
  root: Container;
  ring: Graphics;
  sprite: Sprite;
  body: Graphics;
  label: Text;
}

export class Engine {
  readonly app = new Application();
  readonly world: World;
  private readonly mission: Mission;

  private readonly stage = new Container(); // pannable/zoomable world
  private readonly deckSprite = new Sprite(); // ship-plan art, drawn under everything
  private readonly deckG = new Graphics();
  private readonly doorsG = new Graphics(); // door state (redrawn each frame)
  private readonly hullG = new Graphics(); // pressure tint + breaches (redrawn each frame)
  private readonly fogG = new Graphics();
  private readonly planG = new Graphics();
  private readonly unitLayer = new Container();
  private readonly fxG = new Graphics(); // tracers / muzzle / blasts (above units)
  private readonly views = new Map<number, UnitView>();
  private soldierSheet: Texture | null = null;
  private readonly cellTextures = new Map<number, Texture>();

  paused = true;
  selectedId: number | null = null;
  orderMode: OrderMode = 'move';
  private hover: Point | null = null; // world-space (continuous tile coords)

  private acc = 0;
  private camera = { x: 0, y: 0, scale: 1 };
  private panning = false;
  private rightMaybeClear = false;
  private dragMoved = 0;
  private pointerPrev = { x: 0, y: 0 };

  // press-and-hold gestures (left button, move mode):
  // on a soldier → drag to set his orientation (he'll strafe, holding it);
  // on his planned path → a ghost appears there; drag sets his facing from that point on.
  private orientDrag: { id: number } | null = null;
  private ghostDrag: { id: number; stepIdx: number; at: number; pos: Point; dir: Vec | null } | null = null;
  private ghostSprite: Sprite | null = null;

  private readonly contacted = new Set<number>();
  private readonly downSeen = new Set<number>();
  private readonly log: string[] = [];
  private drainedEvents = 0;
  private emitAcc = 0;

  onSnapshot?: (s: Snapshot) => void;

  constructor(mission: Mission) {
    this.mission = mission;
    this.world = new World(mission.grid, mission.units, mission.seed);
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x05070d, // near-black, blends with the star field around the ship art
      antialias: true,
      resizeTo: host,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    host.appendChild(this.app.canvas);

    this.stage.addChild(this.deckSprite, this.deckG, this.doorsG, this.hullG, this.fogG, this.planG, this.unitLayer, this.fxG);
    this.app.stage.addChild(this.stage);

    try {
      this.soldierSheet = await Assets.load(soldiersUrl);
    } catch {
      this.soldierSheet = null; // fall back to marker rendering if the sheet fails to load
    }
    try {
      // the deck-plan art the grid was traced from — stretch it to cover the grid
      // exactly, so one tile of sim space is one tile of the painted ship
      const deckTex: Texture = await Assets.load(deckUrl);
      this.deckSprite.texture = deckTex;
      this.deckSprite.width = this.mission.grid.width * TILE_PX;
      this.deckSprite.height = this.mission.grid.height * TILE_PX;
    } catch {
      this.deckSprite.visible = false; // fall back to flat tile rendering
    }

    this.drawDeck();
    this.buildUnitViews();
    this.fitCamera();
    this.attachInput();

    this.log.push('Squad breached the aft airlock. Plan your entry.');
    this.log.push('Hostiles hold the deck. Select a soldier and set a path.');

    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
    this.emit();
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }

  // ── loop ──────────────────────────────────────────────────────────────────
  private tick(dt: number): void {
    const clamped = Math.min(0.1, dt);
    if (!this.paused) {
      this.acc += clamped;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 10) {
        this.world.step(FIXED_DT);
        this.acc -= FIXED_DT;
        steps++;
      }
    }
    this.pumpEvents();
    this.checkContacts();
    this.checkCasualties();
    this.drawFrame();
    this.emitAcc += clamped;
    if (this.emitAcc >= EMIT_INTERVAL) {
      this.emitAcc = 0;
      this.emit();
    }
  }

  private pumpEvents(): void {
    for (; this.drainedEvents < this.world.events.length; this.drainedEvents++) {
      this.log.push(this.world.events[this.drainedEvents].text);
    }
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
  }

  /** "Plan meets reality": auto-pause the first time a hostile is seen. */
  private checkContacts(): void {
    for (const u of this.world.units) {
      if (u.faction !== 'hostile' || !u.alive) continue;
      if (this.contacted.has(u.id)) continue;
      if (this.isVisible(u)) {
        this.contacted.add(u.id);
        this.log.push('● CONTACT — hostile spotted.');
        this.autoPause('‖ Auto-paused on contact.');
      }
    }
  }

  /** Auto-pause the moment one of your own goes down — a casualty needs a decision. */
  private checkCasualties(): void {
    for (const u of this.world.units) {
      if (u.faction !== 'friendly' || !u.downed) continue;
      if (this.downSeen.has(u.id)) continue;
      this.downSeen.add(u.id);
      this.autoPause('‖ Auto-paused — casualty.');
    }
  }

  private autoPause(msg: string): void {
    if (!this.paused) {
      this.pause();
      this.log.push(msg);
    }
  }

  // ── camera ────────────────────────────────────────────────────────────────
  private fitCamera(): void {
    const w = this.mission.grid.width * TILE_PX;
    const h = this.mission.grid.height * TILE_PX;
    const vw = this.app.renderer.width / this.app.renderer.resolution;
    const vh = this.app.renderer.height / this.app.renderer.resolution;
    const scale = Math.min(vw / (w + 80), vh / (h + 80));
    this.camera.scale = scale;
    this.camera.x = (vw - w * scale) / 2;
    this.camera.y = (vh - h * scale) / 2;
    this.applyCamera();
  }

  private applyCamera(): void {
    this.stage.position.set(this.camera.x, this.camera.y);
    this.stage.scale.set(this.camera.scale);
  }

  /** Continuous world position (tile-space floats) under a screen point. */
  private screenToWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.camera.x) / this.camera.scale / TILE_PX,
      y: (sy - this.camera.y) / this.camera.scale / TILE_PX,
    };
  }

  private screenToTile(sx: number, sy: number): { x: number; y: number } {
    const w = this.screenToWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  // ── input ─────────────────────────────────────────────────────────────────
  private attachInput(): void {
    const c = this.app.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private localPointer(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown(e: PointerEvent): void {
    const p = this.localPointer(e);
    this.pointerPrev = p;
    this.dragMoved = 0;
    if (e.button === 1) {
      this.panning = true;
      return;
    }
    if (e.button === 2) {
      this.rightMaybeClear = true; // clear-order on click, pan on drag
      return;
    }
    if (e.button === 0) {
      const tile = this.screenToTile(p.x, p.y);
      const w = this.screenToWorld(p.x, p.y);
      // pressing a friendly selects it — and holding starts the orient (strafe) drag
      const friendly = this.friendlyNear(w.x, w.y);
      if (friendly && this.orderMode === 'move') {
        this.selectedId = friendly.id;
        this.orientDrag = { id: friendly.id };
        this.emit();
        return;
      }
      if (this.selectedId == null) return;
      switch (this.orderMode) {
        case 'move': {
          // holding on the planned line drops a ghost whose orientation applies from there
          const hit = this.hitPlannedPath(w);
          if (hit) {
            this.ghostDrag = { ...hit, dir: null };
            this.showGhost(hit.pos);
            return;
          }
          this.issueMove(w.x, w.y, e.shiftKey);
          break;
        }
        case 'breach':
          this.issueBreach(tile.x, tile.y);
          this.setOrderMode('move');
          break;
        case 'flash':
        case 'frag':
          this.issueGrenade(tile.x, tile.y, this.orderMode === 'flash' ? 'flash' : 'frag');
          this.setOrderMode('move');
          break;
        case 'overwatch':
          this.issueOverwatch(tile.x, tile.y);
          this.setOrderMode('move');
          break;
        case 'vent':
          this.issueVent(tile.x, tile.y);
          this.setOrderMode('move');
          break;
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.localPointer(e);
    const dx = p.x - this.pointerPrev.x;
    const dy = p.y - this.pointerPrev.y;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    if (this.panning || (this.rightMaybeClear && this.dragMoved > 6)) {
      this.camera.x += dx;
      this.camera.y += dy;
      this.applyCamera();
    }
    this.pointerPrev = p;
    this.hover = this.screenToWorld(p.x, p.y);

    if (this.orientDrag && this.dragMoved > 6) {
      // live orient: turn the held soldier toward the cursor and lock it (strafe)
      const u = this.world.unit(this.orientDrag.id);
      if (u) {
        const dir = this.dirFrom(u.pos, this.hover);
        if (dir) {
          u.strafe = dir;
          u.facing.x = dir.x;
          u.facing.y = dir.y;
          u.aim.x = dir.x;
          u.aim.y = dir.y;
        }
      }
    }
    if (this.ghostDrag && this.dragMoved > 6) {
      const dir = this.dirFrom(this.ghostDrag.pos, this.hover);
      if (dir) {
        this.ghostDrag.dir = dir;
        if (this.ghostSprite) this.ghostSprite.rotation = Math.atan2(dir.y, dir.x) + Math.PI / 2;
      }
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button === 1) this.panning = false;
    if (e.button === 2) {
      if (this.rightMaybeClear && this.dragMoved <= 6) this.clearSelectedOrder();
      this.rightMaybeClear = false;
    }
    if (e.button === 0) {
      if (this.ghostDrag) {
        this.commitGhost();
        this.ghostDrag = null;
        this.hideGhost();
      }
      this.orientDrag = null; // orientation was applied live during the drag
    }
  }

  /** Unit direction from `from` to `to`, or null inside a small dead zone. */
  private dirFrom(from: Point, to: Point): Vec | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    return d < 0.2 ? null : { x: dx / d, y: dy / d };
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.localPointer(e);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.max(0.35, Math.min(3, this.camera.scale * factor));
    // keep the world point under the cursor stationary
    this.camera.x = p.x - ((p.x - this.camera.x) / this.camera.scale) * next;
    this.camera.y = p.y - ((p.y - this.camera.y) / this.camera.scale) * next;
    this.camera.scale = next;
    this.applyCamera();
  }

  // ── commands (called by UI and input) ───────────────────────────────────────
  togglePause(): void {
    if (this.paused) this.play();
    else this.pause();
  }
  play(): void {
    this.paused = false;
    this.log.push('▶ Executing plan…');
    this.emit();
  }
  pause(): void {
    this.paused = true;
    this.emit();
  }
  selectUnit(id: number): void {
    if (this.world.unit(id)?.faction === 'friendly') {
      this.selectedId = id;
      this.emit();
    }
  }
  setOrderMode(mode: OrderMode): void {
    this.orderMode = mode;
    this.emit();
  }
  toggleHoldFire(): void {
    const u = this.selected();
    if (u) {
      u.weaponsFree = !u.weaponsFree;
      this.log.push(`${u.name}: ${u.weaponsFree ? 'weapons free' : 'hold fire'}.`);
      this.emit();
    }
  }
  /** Cycle selection to the next soldier flagged for attention (contact/down/idle). */
  selectNextAttention(): void {
    const flagged = this.world.units.filter((u) => u.faction === 'friendly' && u.alive && u.attention != null);
    if (!flagged.length) return;
    const cur = flagged.findIndex((u) => u.id === this.selectedId);
    this.selectedId = flagged[(cur + 1) % flagged.length].id;
    this.emit();
  }
  /** Select a unit and give it a move order in one call (used by UI shortcuts/tests). Tile coords. */
  orderMoveTo(id: number, tx: number, ty: number, append = false): void {
    if (this.world.unit(id)?.faction !== 'friendly') return;
    this.selectedId = id;
    this.issueMove(tx + 0.5, ty + 0.5, append);
  }
  orderBreach(id: number, dx: number, dy: number): void {
    if (this.world.unit(id)?.faction !== 'friendly') return;
    this.selectedId = id;
    this.issueBreach(dx, dy);
  }
  orderGrenade(id: number, tx: number, ty: number, gtype: GrenadeType): void {
    if (this.world.unit(id)?.faction !== 'friendly') return;
    this.selectedId = id;
    this.issueGrenade(tx, ty, gtype);
  }
  orderOverwatch(id: number, tx: number, ty: number): void {
    if (this.world.unit(id)?.faction !== 'friendly') return;
    this.selectedId = id;
    this.issueOverwatch(tx, ty);
  }
  orderVent(id: number, dx: number, dy: number): void {
    if (this.world.unit(id)?.faction !== 'friendly') return;
    this.selectedId = id;
    this.issueVent(dx, dy);
  }
  clearSelectedOrder(): void {
    const u = this.selected();
    if (u) {
      u.order = holdOrder();
      u.attention = null;
      u.strafe = null; // unlock the body — face travel again on the next move
      this.setOrderMode('move');
      this.emit();
    }
  }

  // ── plan building (append action waypoints to the selected soldier) ──────────
  /** Exact point the soldier will stand on after its current plan runs (for chaining). */
  private planEndPoint(u: Unit): Point {
    let p = { x: u.pos.x, y: u.pos.y };
    for (const s of u.order.steps) {
      if (s.kind === 'move' && s.path.length) {
        const n = s.path[s.path.length - 1];
        p = { x: n.x, y: n.y };
      }
    }
    return p;
  }
  /** Tile the soldier will occupy after its current plan runs. */
  private planEndTile(u: Unit): { x: number; y: number } {
    const p = this.planEndPoint(u);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }
  /** Route from `from` to the exact point `to`: A* between tiles, string-pulled fluid. */
  private routeTo(from: Point, to: Point): Point[] | null {
    const tiles = findPath(this.mission.grid, Math.floor(from.x), Math.floor(from.y), Math.floor(to.x), Math.floor(to.y));
    if (!tiles) return null;
    return smoothPath(this.mission.grid, from, tiles, to);
  }
  /** True when the soldier is just standing (no pending plan) — start fresh on next step. */
  private isStanding(u: Unit): boolean {
    return u.order.step === 0 && u.order.steps.length === 1 && isPlanComplete(u.order);
  }
  private appendStep(u: Unit, step: Step): void {
    if (this.isStanding(u)) u.order = { steps: [step], step: 0 };
    else u.order.steps.push(step);
    u.attention = null;
  }

  /** Move the selected soldier to an exact world point (continuous, not tile-snapped). */
  private issueMove(wx: number, wy: number, append: boolean): void {
    const u = this.selected();
    if (!u || !this.mission.grid.isWalkable(Math.floor(wx), Math.floor(wy))) return;
    const to = { x: wx, y: wy };
    if (!append) {
      const pts = this.routeTo(u.pos, to);
      if (pts && pts.length) {
        u.order = { steps: [moveStep(pts)], step: 0 };
        u.attention = null;
      }
    } else {
      const pts = this.routeTo(this.planEndPoint(u), to);
      if (pts && pts.length) {
        const last = u.order.steps[u.order.steps.length - 1];
        if (!this.isStanding(u) && last && last.kind === 'move') last.path = last.path.concat(pts);
        else this.appendStep(u, moveStep(pts));
      }
    }
    this.emit();
  }

  private issueBreach(dx: number, dy: number): void {
    const u = this.selected();
    if (!u || this.mission.grid.get(dx, dy) !== DOOR) return;
    const from = this.planEndPoint(u);
    const approach = this.approachTile(dx, dy, this.planEndTile(u));
    if (approach && (approach.x !== Math.floor(from.x) || approach.y !== Math.floor(from.y))) {
      const pts = this.routeTo(from, { x: approach.x + 0.5, y: approach.y + 0.5 });
      if (pts && pts.length) this.appendStep(u, moveStep(pts));
    }
    this.appendStep(u, { kind: 'breach', door: { x: dx, y: dy }, timer: BREACH_TIME });
    this.emit();
  }

  private issueGrenade(tx: number, ty: number, gtype: GrenadeType): void {
    const u = this.selected();
    if (!u || !this.mission.grid.inBounds(tx, ty) || this.mission.grid.isWall(tx, ty)) return;
    this.appendStep(u, { kind: 'grenade', target: { x: tx, y: ty }, gtype, fuse: GRENADE_FUSE, thrown: false });
    this.emit();
  }

  /** Rig a hull charge on an exterior wall to vent the compartment. Needs a breaching weapon. */
  private issueVent(dx: number, dy: number): void {
    const u = this.selected();
    if (!u) return;
    if (!this.world.isHullWall(dx, dy)) {
      this.log.push('Vent: target an exterior hull wall.');
      this.emit();
      return;
    }
    if (weaponOf(u.weapon).hullSafety !== 'breaching') {
      this.log.push(`${u.name} can't cut the hull — needs a breaching weapon (SAW/gauss).`);
      this.emit();
      return;
    }
    const from = this.planEndPoint(u);
    const approach = this.approachTile(dx, dy, this.planEndTile(u));
    if (!approach) return;
    if (approach.x !== Math.floor(from.x) || approach.y !== Math.floor(from.y)) {
      const pts = this.routeTo(from, { x: approach.x + 0.5, y: approach.y + 0.5 });
      if (pts && pts.length) this.appendStep(u, moveStep(pts));
    }
    this.appendStep(u, { kind: 'hullcharge', wall: { x: dx, y: dy }, timer: HULLCHARGE_TIME });
    this.emit();
  }

  private issueOverwatch(tx: number, ty: number): void {
    const u = this.selected();
    if (!u) return;
    const from = this.planEndPoint(u);
    let dx = tx + 0.5 - from.x;
    let dy = ty + 0.5 - from.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    this.appendStep(u, { kind: 'overwatch', dir: { x: dx, y: dy } });
    this.emit();
  }

  /** A walkable, non-door tile beside the door, nearest to `from` (the stack point). */
  private approachTile(dx: number, dy: number, from: { x: number; y: number }): { x: number; y: number } | null {
    const cands = [
      { x: dx + 1, y: dy },
      { x: dx - 1, y: dy },
      { x: dx, y: dy + 1 },
      { x: dx, y: dy - 1 },
    ].filter((t) => this.mission.grid.isWalkable(t.x, t.y) && this.mission.grid.get(t.x, t.y) !== DOOR);
    cands.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    return cands[0] ?? null;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  private selected(): Unit | undefined {
    return this.selectedId == null ? undefined : this.world.unit(this.selectedId);
  }
  /** The living friendly whose body disc is under a continuous world point. */
  private friendlyNear(wx: number, wy: number): Unit | undefined {
    return this.world.units.find(
      (u) => u.alive && u.faction === 'friendly' && Math.hypot(u.pos.x - wx, u.pos.y - wy) <= 0.55,
    );
  }

  /**
   * Hit-test a world point against the selected soldier's remaining planned line.
   * Returns which move step was hit, the exact point on the line, and `at` — the
   * step's polyline distance there (comparable with the step's `traveled`).
   */
  private hitPlannedPath(w: Point): { id: number; stepIdx: number; at: number; pos: Point } | null {
    const u = this.selected();
    if (!u || !isActive(u)) return null;
    const threshold = 10 / (this.camera.scale * TILE_PX); // ~10 screen px, in tiles
    let cursor: Point = { x: u.pos.x, y: u.pos.y };
    let best: { id: number; stepIdx: number; at: number; pos: Point; d: number } | null = null;
    for (let i = u.order.step; i < u.order.steps.length; i++) {
      const s = u.order.steps[i];
      if (s.kind !== 'move') continue;
      const active = i === u.order.step;
      const nodes = active ? s.path.slice(s.index) : s.path;
      let at = active ? s.traveled : 0;
      let prev = cursor;
      for (const n of nodes) {
        const seg = { x: n.x - prev.x, y: n.y - prev.y };
        const len = Math.hypot(seg.x, seg.y);
        if (len > 1e-6) {
          const t = Math.max(0, Math.min(1, ((w.x - prev.x) * seg.x + (w.y - prev.y) * seg.y) / (len * len)));
          const px = prev.x + seg.x * t;
          const py = prev.y + seg.y * t;
          const d = Math.hypot(w.x - px, w.y - py);
          if (d <= threshold && (!best || d < best.d)) {
            best = { id: u.id, stepIdx: i, at: at + len * t, pos: { x: px, y: py }, d };
          }
          at += len;
        }
        prev = n;
      }
      cursor = prev;
    }
    if (!best) return null;
    return { id: best.id, stepIdx: best.stepIdx, at: best.at, pos: best.pos };
  }

  // ── ghost (orientation waypoint being placed on the planned line) ────────────
  private showGhost(pos: Point): void {
    const u = this.selected();
    if (!u) return;
    const src = this.views.get(u.id)?.sprite;
    const ghost = new Sprite(src?.texture ?? Texture.EMPTY);
    ghost.anchor.set(0.5);
    if (src) ghost.scale.set(src.scale.x);
    ghost.alpha = 0.45;
    ghost.rotation = src?.rotation ?? 0;
    ghost.position.set(pos.x * TILE_PX, pos.y * TILE_PX);
    this.unitLayer.addChild(ghost);
    this.ghostSprite = ghost;
  }

  private hideGhost(): void {
    if (this.ghostSprite) {
      this.ghostSprite.destroy();
      this.ghostSprite = null;
    }
  }

  /** Drop the dragged ghost orientation into the move step as a facing waypoint. */
  private commitGhost(): void {
    const gd = this.ghostDrag;
    if (!gd || !gd.dir) return; // released without choosing a direction — cancel
    const u = this.world.unit(gd.id);
    const s = u?.order.steps[gd.stepIdx];
    if (!u || !s || s.kind !== 'move') return;
    const wp: FacingWaypoint = { at: gd.at, pos: { x: gd.pos.x, y: gd.pos.y }, dir: gd.dir };
    // waypoints later on the line override earlier ones from their point onward
    const idx = s.facings.findIndex((f) => f.at > wp.at);
    if (idx < 0) s.facings.push(wp);
    else s.facings.splice(idx, 0, wp);
    this.emit();
  }
  /** Currently within reveal radius of a living friendly (fog "visible now"). */
  private isVisible(u: Unit): boolean {
    for (const f of this.world.units) {
      if (!f.alive || f.faction !== 'friendly') continue;
      if (Math.max(Math.abs(f.pos.x - u.pos.x), Math.abs(f.pos.y - u.pos.y)) <= REVEAL_RADIUS)
        return true;
    }
    return false;
  }

  // ── static deck render (drawn once) ─────────────────────────────────────────
  /** The ship art already paints floors and walls; tiles are only drawn as a fallback. */
  private drawDeck(): void {
    if (this.deckSprite.visible && this.deckSprite.texture) return;
    const g = this.deckG;
    const grid = this.mission.grid;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const k = grid.get(x, y);
        if (k === SPACE) continue; // vacuum — leave the void black
        const px = x * TILE_PX;
        const py = y * TILE_PX;
        if (k === WALL) {
          g.rect(px, py, TILE_PX, TILE_PX).fill(COLORS.wall);
          g.rect(px + 0.5, py + 0.5, TILE_PX - 1, TILE_PX - 1).stroke({ width: 1, color: COLORS.wallEdge });
        } else {
          // floor (and door frame — the door leaf itself is drawn dynamically)
          g.rect(px, py, TILE_PX, TILE_PX).fill(COLORS.floor);
          g.rect(px + 0.5, py + 0.5, TILE_PX - 1, TILE_PX - 1).stroke({ width: 1, color: COLORS.line });
        }
      }
    }
  }

  /** Doors change state during play, so they render per-frame: closed = solid leaf. */
  private drawDoors(): void {
    const g = this.doorsG;
    g.clear();
    const grid = this.mission.grid;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.get(x, y) !== DOOR) continue;
        const px = x * TILE_PX;
        const py = y * TILE_PX;
        if (this.world.isDoorClosed(x, y)) {
          // muted steel leaf with an amber frame + status light, so it sits with the ship art
          g.rect(px + 3, py + 3, TILE_PX - 6, TILE_PX - 6).fill({ color: 0x232a33, alpha: 0.9 });
          g.rect(px + 3, py + 3, TILE_PX - 6, TILE_PX - 6).stroke({ width: 1.5, color: COLORS.door, alpha: 0.9 });
          g.circle(px + TILE_PX / 2, py + TILE_PX / 2, 1.8).fill({ color: COLORS.door });
        } else {
          // open: just the frame, recessed
          g.rect(px + 4, py + 4, TILE_PX - 8, TILE_PX - 8).stroke({ width: 1.5, color: COLORS.door, alpha: 0.5 });
        }
      }
    }
  }

  /** A sub-texture for one trooper cell of the sheet (background is transparent). */
  private cellTexture(index: number): Texture | null {
    if (!this.soldierSheet) return null;
    const cached = this.cellTextures.get(index);
    if (cached) return cached;
    const col = index % SHEET_COLS;
    const row = Math.floor(index / SHEET_COLS) % SHEET_ROWS;
    const frame = new Rectangle(col * CELL_W, row * CELL_H, CELL_W, CELL_H);
    const tex = new Texture({ source: this.soldierSheet.source, frame });
    this.cellTextures.set(index, tex);
    return tex;
  }

  private buildUnitViews(): void {
    let fi = 0;
    let hi = 0;
    for (const u of this.world.units) {
      const root = new Container();
      const ring = new Graphics();
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      // friendlies get the first cells; hostiles get later cells and a red tint
      const cell = u.faction === 'friendly' ? fi++ : 18 + hi++;
      const tex = this.cellTexture(cell);
      if (tex) {
        sprite.texture = tex;
        // human-scale against the ship art: a trooper spans just over a tile
        const scale = (TILE_PX * 1.2) / tex.frame.height;
        sprite.scale.set(scale);
      } else {
        sprite.visible = false;
      }
      const body = new Graphics();
      const label = new Text({
        text: '',
        style: { fill: COLORS.ink, fontFamily: FONT_MONO, fontSize: 11, fontWeight: 'bold' },
      });
      label.anchor.set(0.5);
      root.addChild(ring, sprite, body, label);
      this.unitLayer.addChild(root);
      this.views.set(u.id, { root, ring, sprite, body, label });
    }
  }

  // ── per-frame render ────────────────────────────────────────────────────────
  private drawFrame(): void {
    this.drawDoors();
    this.drawHull();
    this.drawFog();
    this.drawPlan();
    this.drawUnits();
    this.drawFx();
  }

  /** Pressure tint (venting → vacuum), hull breaches, and the pull toward them. */
  private drawHull(): void {
    const g = this.hullG;
    g.clear();
    if (this.world.breaches.size === 0) return;
    const grid = this.mission.grid;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.isWall(x, y) || grid.isSpace(x, y)) continue;
        const p = this.world.pressureAt(x, y);
        if (p > 0.97) continue;
        // low pressure → blue vacuum tint; deeper as pressure drops
        const alpha = (1 - p) * 0.6;
        g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0x0b3b5a, alpha });
      }
    }
    // pull streaks from actively-venting tiles toward the nearest breach
    for (const idx of this.world.venting) {
      const x = idx % grid.width;
      const y = Math.floor(idx / grid.width);
      if (!this.world.isViolent(x, y)) continue;
      const b = this.nearestBreachPx(x + 0.5, y + 0.5);
      if (!b) continue;
      const cx = (x + 0.5) * TILE_PX;
      const cy = (y + 0.5) * TILE_PX;
      const dx = b.x - cx;
      const dy = b.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      g.moveTo(cx, cy)
        .lineTo(cx + (dx / d) * TILE_PX * 0.5, cy + (dy / d) * TILE_PX * 0.5)
        .stroke({ width: 1, color: 0x8fd8ff, alpha: 0.35 });
    }
    // the breaches themselves — a hot ragged glow
    for (const idx of this.world.breaches) {
      const bx = (idx % grid.width + 0.5) * TILE_PX;
      const by = (Math.floor(idx / grid.width) + 0.5) * TILE_PX;
      g.circle(bx, by, TILE_PX * 0.5).fill({ color: 0x000000, alpha: 0.9 });
      g.circle(bx, by, TILE_PX * 0.5).stroke({ width: 2, color: COLORS.orange });
      g.star(bx, by, 6, TILE_PX * 0.42, TILE_PX * 0.2).stroke({ width: 1.5, color: COLORS.red, alpha: 0.8 });
    }
  }

  private nearestBreachPx(fx: number, fy: number): { x: number; y: number } | null {
    const grid = this.mission.grid;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const idx of this.world.breaches) {
      const bx = idx % grid.width + 0.5;
      const by = Math.floor(idx / grid.width) + 0.5;
      const d = Math.hypot(fx - bx, fy - by);
      if (d < bestD) {
        bestD = d;
        best = { x: bx * TILE_PX, y: by * TILE_PX };
      }
    }
    return best;
  }

  /** Tracers + muzzle flashes for shots fired in the last handful of frames. */
  private drawFx(): void {
    const g = this.fxG;
    g.clear();
    for (const s of this.world.shots) {
      const fromVisible = s.faction === 'friendly' || this.tileVisibleNow(Math.floor(s.from.x), Math.floor(s.from.y));
      if (!fromVisible) continue;
      const color = s.faction === 'friendly' ? COLORS.cyan : COLORS.red;
      g.moveTo(s.from.x * TILE_PX, s.from.y * TILE_PX)
        .lineTo(s.to.x * TILE_PX, s.to.y * TILE_PX)
        .stroke({ width: s.hit ? 2 : 1, color, alpha: s.hit ? 0.85 : 0.35 });
      g.circle(s.from.x * TILE_PX, s.from.y * TILE_PX, 3).fill({ color, alpha: 0.9 });
      if (s.hit) g.circle(s.to.x * TILE_PX, s.to.y * TILE_PX, 4).stroke({ width: 1.5, color: COLORS.orange });
    }
    // grenade / breach detonations — an expanding ring that fades with age
    for (const bl of this.world.blasts) {
      const age = (this.world.time - bl.time) / 0.4;
      if (age > 1) continue;
      const color = bl.kind === 'frag' ? COLORS.red : bl.kind === 'flash' ? 0xffffff : COLORS.orange;
      g.circle(bl.pos.x * TILE_PX, bl.pos.y * TILE_PX, bl.radius * TILE_PX * (0.4 + 0.6 * age))
        .stroke({ width: 3, color, alpha: 1 - age });
      if (bl.kind === 'flash')
        g.circle(bl.pos.x * TILE_PX, bl.pos.y * TILE_PX, bl.radius * TILE_PX * 0.5).fill({ color: 0xffffff, alpha: 0.25 * (1 - age) });
    }
  }

  private drawFog(): void {
    const g = this.fogG;
    g.clear();
    const grid = this.mission.grid;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.get(x, y) === SPACE) continue; // the void outside the hull is never fogged
        const idx = grid.idx(x, y);
        if (!this.world.seen.has(idx)) {
          g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({ color: COLORS.fogUnseen, alpha: 1 });
        } else if (!this.tileVisibleNow(x, y)) {
          g.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0x000000, alpha: 0.45 });
        }
      }
    }
  }

  private tileVisibleNow(x: number, y: number): boolean {
    for (const f of this.world.units) {
      if (!f.alive || f.faction !== 'friendly') continue;
      if (Math.max(Math.abs(f.pos.x - (x + 0.5)), Math.abs(f.pos.y - (y + 0.5))) <= REVEAL_RADIUS)
        return true;
    }
    return false;
  }

  private drawPlan(): void {
    const g = this.planG;
    g.clear();
    for (const u of this.world.units) {
      if (u.faction !== 'friendly' || !u.alive || u.downed) continue;
      if (isPlanComplete(u.order) && currentStep(u.order).kind !== 'overwatch') continue;
      this.drawUnitPlan(g, u, u.id === this.selectedId);
    }
    // live route preview from the selected unit to the hovered point while planning
    if (this.paused && this.hover && this.orderMode === 'move' && !this.orientDrag && !this.ghostDrag) {
      const u = this.selected();
      if (u && this.mission.grid.isWalkable(Math.floor(this.hover.x), Math.floor(this.hover.y))) {
        const from = this.planEndPoint(u);
        const preview = this.routeTo(from, this.hover);
        if (preview && preview.length) {
          this.dashedPolyline(g, [from, ...preview], { width: 1, color: COLORS.cyan, alpha: 0.3 });
        }
      }
    }
    // the ghost's chosen orientation, while the player is dragging it out
    if (this.ghostDrag?.dir) {
      const { pos, dir } = this.ghostDrag;
      g.moveTo(pos.x * TILE_PX, pos.y * TILE_PX)
        .lineTo((pos.x + dir.x * 0.9) * TILE_PX, (pos.y + dir.y * 0.9) * TILE_PX)
        .stroke({ width: 2, color: COLORS.cyan, alpha: 0.8 });
    }
  }

  /** Stroke a polyline (world tile coords) as a dotted/dashed line. */
  private dashedPolyline(
    g: Graphics,
    pts: Point[],
    style: { width: number; color: number; alpha: number },
    dash = 5,
    gap = 5,
  ): void {
    let carry = 0; // pattern offset carried across segments so corners don't reset it
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x * TILE_PX;
      const ay = pts[i - 1].y * TILE_PX;
      const bx = pts[i].x * TILE_PX;
      const by = pts[i].y * TILE_PX;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-3) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      let t = -carry;
      while (t < len) {
        const s0 = Math.max(0, t);
        const s1 = Math.min(len, t + dash);
        if (s1 > s0) {
          g.moveTo(ax + ux * s0, ay + uy * s0).lineTo(ax + ux * s1, ay + uy * s1);
        }
        t += dash + gap;
      }
      carry = (len + carry) % (dash + gap);
    }
    g.stroke(style);
  }

  /** Walk a soldier's plan steps and draw legs, breach/grenade markers, overwatch cones. */
  private drawUnitPlan(g: Graphics, u: Unit, sel: boolean): void {
    const color = sel ? COLORS.cyan : COLORS.cyanDim;
    const alpha = sel ? 0.95 : 0.45;
    let cx = u.pos.x;
    let cy = u.pos.y;
    for (let i = u.order.step; i < u.order.steps.length; i++) {
      const s = u.order.steps[i];
      if (s.kind === 'move') {
        const nodes = i === u.order.step ? s.path.slice(s.index) : s.path;
        if (!nodes.length) continue;
        this.dashedPolyline(g, [{ x: cx, y: cy }, ...nodes], { width: sel ? 2 : 1.5, color, alpha });
        // orientation waypoints ahead on this leg: a dot with a facing tick
        for (const wp of s.facings) {
          const wx = wp.pos.x * TILE_PX;
          const wy = wp.pos.y * TILE_PX;
          g.circle(wx, wy, 3.5).fill({ color, alpha });
          g.moveTo(wx + wp.dir.x * 5, wy + wp.dir.y * 5)
            .lineTo(wx + wp.dir.x * TILE_PX * 0.55, wy + wp.dir.y * TILE_PX * 0.55)
            .stroke({ width: 2, color, alpha: alpha * 0.9 });
        }
        const last = nodes[nodes.length - 1];
        // destination marker so the exact clicked point reads clearly
        g.circle(last.x * TILE_PX, last.y * TILE_PX, 3).stroke({ width: 1.5, color, alpha });
        cx = last.x;
        cy = last.y;
      } else if (s.kind === 'breach') {
        const bx = (s.door.x + 0.5) * TILE_PX;
        const by = (s.door.y + 0.5) * TILE_PX;
        const r = TILE_PX * 0.34;
        g.moveTo(bx - r, by - r).lineTo(bx + r, by + r).moveTo(bx + r, by - r).lineTo(bx - r, by + r)
          .stroke({ width: 2.5, color: COLORS.orange, alpha });
        g.circle(bx, by, r).stroke({ width: 1.5, color: COLORS.orange, alpha });
      } else if (s.kind === 'hullcharge') {
        const wx = (s.wall.x + 0.5) * TILE_PX;
        const wy = (s.wall.y + 0.5) * TILE_PX;
        g.star(wx, wy, 6, TILE_PX * 0.4, TILE_PX * 0.18).stroke({ width: 2, color: COLORS.red, alpha });
        g.circle(wx, wy, TILE_PX * 0.44).stroke({ width: 1.5, color: COLORS.red, alpha: alpha * 0.7 });
      } else if (s.kind === 'grenade') {
        const tx = (s.target.x + 0.5) * TILE_PX;
        const ty = (s.target.y + 0.5) * TILE_PX;
        const gc = s.gtype === 'frag' ? COLORS.red : 0xffffff;
        g.moveTo(cx * TILE_PX, cy * TILE_PX).lineTo(tx, ty).stroke({ width: 1, color: gc, alpha: alpha * 0.7 });
        const rad = s.gtype === 'frag' ? 2.6 : 3.5;
        g.circle(tx, ty, rad * TILE_PX).stroke({ width: 1, color: gc, alpha: alpha * 0.5 });
        g.circle(tx, ty, 4).fill({ color: gc, alpha });
      } else if (s.kind === 'overwatch') {
        this.drawCone(g, cx, cy, s.dir, color, alpha);
      }
    }
  }

  private drawCone(g: Graphics, cx: number, cy: number, dir: { x: number; y: number }, color: number, alpha: number): void {
    const ox = cx * TILE_PX;
    const oy = cy * TILE_PX;
    const range = 5 * TILE_PX;
    const base = Math.atan2(dir.y, dir.x);
    const half = Math.PI / 3; // ~60°, matches the sim's overwatch arc
    g.moveTo(ox, oy)
      .lineTo(ox + Math.cos(base - half) * range, oy + Math.sin(base - half) * range)
      .arc(ox, oy, range, base - half, base + half)
      .lineTo(ox, oy)
      .fill({ color, alpha: alpha * 0.12 });
    g.moveTo(ox, oy).lineTo(ox + Math.cos(base - half) * range, oy + Math.sin(base - half) * range)
      .stroke({ width: 1, color, alpha: alpha * 0.5 });
    g.moveTo(ox, oy).lineTo(ox + Math.cos(base + half) * range, oy + Math.sin(base + half) * range)
      .stroke({ width: 1, color, alpha: alpha * 0.5 });
  }

  private drawUnits(): void {
    for (const u of this.world.units) {
      const view = this.views.get(u.id)!;
      const visible = u.faction === 'friendly' || this.isVisible(u);
      // keep dead hostiles hidden; show downed friendlies as casualties
      view.root.visible = visible && (u.alive || (u.downed && u.faction === 'friendly'));
      if (!view.root.visible) continue;
      view.root.position.set(u.pos.x * TILE_PX, u.pos.y * TILE_PX);
      const color = u.faction === 'friendly' ? COLORS.cyan : COLORS.red;

      view.ring.clear();
      view.body.clear();
      view.label.text = '';

      // downed friendly → a muted casualty marker, no combat chrome
      if (u.downed) {
        view.sprite.visible = false;
        const r = TILE_PX * 0.26;
        view.body
          .moveTo(-r, -r)
          .lineTo(r, r)
          .moveTo(r, -r)
          .lineTo(-r, r)
          .stroke({ width: 2.5, color: COLORS.muted });
        view.body.circle(0, 0, TILE_PX * 0.34).stroke({ width: 1, color: COLORS.red, alpha: 0.6 });
        continue;
      }

      // the trooper sprite: the BODY points along its travel facing (sheet art aims
      // "up"), tint foes red. The weapon may be tracking a different direction — that's
      // drawn as an aim line below, so a soldier can run one way while firing another.
      if (view.sprite.texture) {
        view.sprite.visible = true;
        view.sprite.rotation = Math.atan2(u.facing.y, u.facing.x) + Math.PI / 2;
        view.sprite.tint = u.faction === 'friendly' ? 0xffffff : 0xff7a5c;
      }

      // weapon aim line whenever the gun is off the body axis or actively on a target
      const step = currentStep(u.order);
      const aiming = u.targetId != null || step.kind === 'overwatch';
      if (aiming) {
        const ax = u.aim.x;
        const ay = u.aim.y;
        view.body
          .moveTo(ax * TILE_PX * 0.22, ay * TILE_PX * 0.22)
          .lineTo(ax * TILE_PX * 0.62, ay * TILE_PX * 0.62)
          .stroke({ width: 2, color, alpha: 0.9 });
        view.body.circle(ax * TILE_PX * 0.62, ay * TILE_PX * 0.62, 1.6).fill({ color, alpha: 0.9 });
      }

      // a soft footprint disc under each trooper so friend/foe reads at a glance
      view.ring.circle(0, 0, TILE_PX * 0.46).fill({ color, alpha: 0.1 });
      if (u.id === this.selectedId) view.ring.circle(0, 0, TILE_PX * 0.52).stroke({ width: 2, color });
      if (u.attention === 'path-complete' && u.faction === 'friendly')
        view.ring.circle(0, 0, TILE_PX * 0.56).stroke({ width: 1, color: COLORS.orange, alpha: 0.7 });
      if (u.suppressedUntil > this.world.time)
        view.ring.circle(0, 0, TILE_PX * 0.48).stroke({ width: 3, color: COLORS.orange, alpha: 0.5 });
      if (isStunned(u, this.world.time)) {
        for (let a = 0; a < 8; a++) {
          const t0 = (a / 8) * Math.PI * 2;
          view.ring.arc(0, 0, TILE_PX * 0.52, t0, t0 + 0.35).stroke({ width: 2.5, color: 0xffffff, alpha: 0.85 });
        }
      }
      if (u.suit) view.ring.circle(0, 0, TILE_PX * 0.58).stroke({ width: 1.5, color: 0x8fd8ff, alpha: 0.6 });
      else if (this.world.pressureAt(Math.floor(u.pos.x), Math.floor(u.pos.y)) < 0.3)
        view.ring.circle(0, 0, TILE_PX * 0.58).stroke({ width: 2, color: COLORS.red, alpha: 0.8 });

      // hp + stress pips, below the trooper so the art stays clear
      const w = TILE_PX * 0.7;
      const py = TILE_PX * 0.62;
      view.body.rect(-w / 2, py, w, 3).fill(COLORS.wall);
      view.body.rect(-w / 2, py, (w * Math.max(0, u.hp)) / u.maxHp, 3).fill(color);
      if (u.stress > 1) view.body.rect(-w / 2, py + 4, (w * Math.min(100, u.stress)) / 100, 2).fill(COLORS.orange);

      // small index tag for friendlies (foes read by their red tint)
      if (u.faction === 'friendly') {
        const n = this.world.units.filter((x) => x.faction === 'friendly').indexOf(u) + 1;
        view.label.text = String(n);
        view.label.position.set(-TILE_PX * 0.42, -TILE_PX * 0.42);
      }
    }
  }

  // ── snapshot to UI ──────────────────────────────────────────────────────────
  private emit(): void {
    if (!this.onSnapshot) return;
    const units: UnitSnapshot[] = this.world.units.map((u) => ({
      id: u.id,
      name: u.name,
      faction: u.faction,
      hp: Math.round(u.hp),
      maxHp: u.maxHp,
      alive: u.alive,
      downed: u.downed,
      needsAttention: u.attention != null,
      visible: u.faction === 'friendly' || this.isVisible(u),
      stress: Math.round(u.stress),
      stunned: isStunned(u, this.world.time),
      weaponsFree: u.weaponsFree,
      suit: u.suit,
      inVacuum: !u.suit && this.world.pressureAt(Math.floor(u.pos.x), Math.floor(u.pos.y)) < 0.3,
      weapon: weaponOf(u.weapon).name,
      hullSafety: weaponOf(u.weapon).hullSafety,
      armor: u.armor,
      status: this.statusOf(u),
    }));
    this.onSnapshot({
      paused: this.paused,
      time: this.world.time,
      missionName: this.mission.name,
      selectedId: this.selectedId,
      orderMode: this.orderMode,
      attentionCount: this.world.units.filter((u) => u.faction === 'friendly' && u.alive && u.attention != null).length,
      units,
      log: this.log.slice(-8),
    });
  }

  private statusOf(u: Unit): string {
    if (!u.alive) return 'K.I.A.';
    if (u.downed) return 'DOWN — BLEEDING';
    if (u.faction === 'hostile') return this.isVisible(u) ? 'CONTACT' : 'UNKNOWN';
    if (isStunned(u, this.world.time)) return 'STUNNED';
    const tx = Math.floor(u.pos.x);
    const ty = Math.floor(u.pos.y);
    if (!u.suit && this.world.pressureAt(tx, ty) < 0.3) return 'SUFFOCATING';
    if (!u.suit && this.world.isViolent(tx, ty)) return 'VENTING!';
    const step = currentStep(u.order);
    if (step.kind === 'hullcharge') return 'RIGGING HULL';
    if (step.kind === 'breach') return 'BREACHING';
    if (step.kind === 'grenade') return step.gtype === 'flash' ? 'FLASH OUT' : 'FRAG OUT';
    if (step.kind === 'overwatch') return u.weaponsFree ? 'OVERWATCH' : 'OW · HOLD';
    if (u.suppressedUntil > this.world.time) return 'PINNED';
    if (u.targetId != null && isActive(this.world.unit(u.targetId) ?? u)) return 'FIRING';
    if (step.kind === 'move' && step.index < step.path.length) return this.paused ? 'ORDERS SET' : 'MOVING';
    if (!u.weaponsFree) return 'HOLD FIRE';
    if (u.attention === 'path-complete') return 'IN POSITION';
    return 'HOLDING';
  }
}
