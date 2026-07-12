// The engine owns everything NON-deterministic: Pixi rendering, the pan/zoom
// camera, pointer input, and the fixed-timestep game loop. It drives the pure sim
// in sim/ and never lets rendering mutate authoritative state. "Pause" simply stops
// feeding ticks to the sim — orders can still be edited while paused, which *is* the
// plan-then-execute loop (DESIGN §4.1).

import { Application, Container, Graphics, Text } from 'pixi.js';
import { DOOR, WALL } from '../sim/grid';
import { findPath } from '../sim/pathfinding';
import { moveOrder } from '../sim/orders';
import { Unit } from '../sim/unit';
import { World, REVEAL_RADIUS } from '../sim/world';
import { Mission } from '../content/maps';
import { COLORS, FONT_MONO } from '../ui/theme';

const TILE_PX = 28;
const FIXED_DT = 1 / 60; // deterministic sim step
const EMIT_INTERVAL = 0.1; // throttle UI snapshots to ~10 Hz

export interface UnitSnapshot {
  id: number;
  name: string;
  faction: 'friendly' | 'hostile';
  hp: number;
  maxHp: number;
  alive: boolean;
  status: string;
  needsAttention: boolean;
  visible: boolean;
}

export interface Snapshot {
  paused: boolean;
  time: number;
  missionName: string;
  selectedId: number | null;
  units: UnitSnapshot[];
  log: string[];
}

interface UnitView {
  root: Container;
  ring: Graphics;
  body: Graphics;
  label: Text;
}

export class Engine {
  readonly app = new Application();
  readonly world: World;
  private readonly mission: Mission;

  private readonly stage = new Container(); // pannable/zoomable world
  private readonly deckG = new Graphics();
  private readonly fogG = new Graphics();
  private readonly planG = new Graphics();
  private readonly unitLayer = new Container();
  private readonly views = new Map<number, UnitView>();

  paused = true;
  selectedId: number | null = null;
  private hover: { x: number; y: number } | null = null;

  private acc = 0;
  private camera = { x: 0, y: 0, scale: 1 };
  private panning = false;
  private rightMaybeClear = false;
  private dragMoved = 0;
  private pointerPrev = { x: 0, y: 0 };

  private readonly contacted = new Set<number>();
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
      background: COLORS.navy,
      antialias: true,
      resizeTo: host,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    host.appendChild(this.app.canvas);

    this.stage.addChild(this.deckG, this.fogG, this.planG, this.unitLayer);
    this.app.stage.addChild(this.stage);

    this.drawDeck();
    this.buildUnitViews();
    this.fitCamera();
    this.attachInput();

    this.log.push('Squad breached the airlock. Plan your entry.');
    this.log.push('Two rooms ahead. Select a soldier and set a path.');

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

  /** M1 flavour of "plan meets reality": auto-pause the first time a hostile is seen. */
  private checkContacts(): void {
    for (const u of this.world.units) {
      if (u.faction !== 'hostile' || !u.alive) continue;
      if (this.contacted.has(u.id)) continue;
      if (this.isVisible(u)) {
        this.contacted.add(u.id);
        this.log.push('● CONTACT — hostile spotted.');
        if (!this.paused) {
          this.pause();
          this.log.push('‖ Auto-paused on contact.');
        }
      }
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

  private screenToTile(sx: number, sy: number): { x: number; y: number } {
    const wx = (sx - this.camera.x) / this.camera.scale / TILE_PX;
    const wy = (sy - this.camera.y) / this.camera.scale / TILE_PX;
    return { x: Math.floor(wx), y: Math.floor(wy) };
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
      const hit = this.friendlyAt(tile.x, tile.y) ?? this.hostileAtVisible(tile.x, tile.y);
      if (hit && hit.faction === 'friendly') {
        this.selectedId = hit.id;
        this.emit();
        return;
      }
      if (this.selectedId != null) this.issueMove(tile.x, tile.y, e.shiftKey);
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
    this.hover = this.screenToTile(p.x, p.y);
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button === 1) this.panning = false;
    if (e.button === 2) {
      if (this.rightMaybeClear && this.dragMoved <= 6) this.clearSelectedOrder();
      this.rightMaybeClear = false;
    }
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
  clearSelectedOrder(): void {
    const u = this.selected();
    if (u) {
      u.order = { kind: 'hold' };
      u.attention = null;
      this.emit();
    }
  }

  private issueMove(tx: number, ty: number, append: boolean): void {
    const u = this.selected();
    if (!u || !this.mission.grid.isWalkable(tx, ty)) return;
    if (append && u.order.kind === 'move' && u.order.path.length > 0) {
      const from = u.order.path[u.order.path.length - 1];
      const seg = findPath(this.mission.grid, from.x, from.y, tx, ty);
      if (seg && seg.length) u.order.path = u.order.path.concat(seg);
    } else {
      const from = { x: Math.floor(u.pos.x), y: Math.floor(u.pos.y) };
      const path = findPath(this.mission.grid, from.x, from.y, tx, ty);
      if (path && path.length) {
        u.order = moveOrder(path);
        u.attention = null;
      }
    }
    this.emit();
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  private selected(): Unit | undefined {
    return this.selectedId == null ? undefined : this.world.unit(this.selectedId);
  }
  private friendlyAt(x: number, y: number): Unit | undefined {
    return this.world.units.find(
      (u) => u.alive && u.faction === 'friendly' && Math.floor(u.pos.x) === x && Math.floor(u.pos.y) === y,
    );
  }
  private hostileAtVisible(x: number, y: number): Unit | undefined {
    return this.world.units.find(
      (u) =>
        u.alive &&
        u.faction === 'hostile' &&
        this.isVisible(u) &&
        Math.floor(u.pos.x) === x &&
        Math.floor(u.pos.y) === y,
    );
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
  private drawDeck(): void {
    const g = this.deckG;
    const grid = this.mission.grid;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const k = grid.get(x, y);
        const px = x * TILE_PX;
        const py = y * TILE_PX;
        if (k === WALL) {
          g.rect(px, py, TILE_PX, TILE_PX).fill(COLORS.wall);
          g.rect(px + 0.5, py + 0.5, TILE_PX - 1, TILE_PX - 1).stroke({ width: 1, color: COLORS.wallEdge });
        } else {
          g.rect(px, py, TILE_PX, TILE_PX).fill(COLORS.floor);
          g.rect(px + 0.5, py + 0.5, TILE_PX - 1, TILE_PX - 1).stroke({ width: 1, color: COLORS.line });
          if (k === DOOR) {
            g.rect(px + 4, py + 4, TILE_PX - 8, TILE_PX - 8).stroke({ width: 2, color: COLORS.door });
          }
        }
      }
    }
  }

  private buildUnitViews(): void {
    for (const u of this.world.units) {
      const root = new Container();
      const ring = new Graphics();
      const body = new Graphics();
      const label = new Text({
        text: u.faction === 'friendly' ? '' : 'E',
        style: { fill: COLORS.navy, fontFamily: FONT_MONO, fontSize: 12, fontWeight: 'bold' },
      });
      label.anchor.set(0.5);
      root.addChild(ring, body, label);
      this.unitLayer.addChild(root);
      this.views.set(u.id, { root, ring, body, label });
    }
  }

  // ── per-frame render ────────────────────────────────────────────────────────
  private drawFrame(): void {
    this.drawFog();
    this.drawPlan();
    this.drawUnits();
  }

  private drawFog(): void {
    const g = this.fogG;
    g.clear();
    const grid = this.mission.grid;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
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
      if (u.faction !== 'friendly' || u.order.kind !== 'move') continue;
      const sel = u.id === this.selectedId;
      const remaining = u.order.path.slice(u.order.index);
      if (!remaining.length) continue;
      const color = sel ? COLORS.cyan : COLORS.cyanDim;
      g.moveTo(u.pos.x * TILE_PX, u.pos.y * TILE_PX);
      for (const n of remaining) g.lineTo((n.x + 0.5) * TILE_PX, (n.y + 0.5) * TILE_PX);
      g.stroke({ width: sel ? 2 : 1.5, color, alpha: sel ? 0.95 : 0.5 });
      const d = remaining[remaining.length - 1];
      g.rect((d.x + 0.5) * TILE_PX - 6, (d.y + 0.5) * TILE_PX - 6, 12, 12).stroke({ width: 1.5, color });
    }
    // live A* preview from the selected unit to the hovered tile while planning
    if (this.paused && this.hover) {
      const u = this.selected();
      if (u && this.mission.grid.isWalkable(this.hover.x, this.hover.y)) {
        const from = { x: Math.floor(u.pos.x), y: Math.floor(u.pos.y) };
        const preview = findPath(this.mission.grid, from.x, from.y, this.hover.x, this.hover.y);
        if (preview && preview.length) {
          g.moveTo(u.pos.x * TILE_PX, u.pos.y * TILE_PX);
          for (const n of preview) g.lineTo((n.x + 0.5) * TILE_PX, (n.y + 0.5) * TILE_PX);
          g.stroke({ width: 1, color: COLORS.cyan, alpha: 0.3 });
        }
      }
    }
  }

  private drawUnits(): void {
    for (const u of this.world.units) {
      const view = this.views.get(u.id)!;
      const visible = u.faction === 'friendly' || this.isVisible(u);
      view.root.visible = visible && u.alive;
      if (!view.root.visible) continue;
      view.root.position.set(u.pos.x * TILE_PX, u.pos.y * TILE_PX);
      const color = u.faction === 'friendly' ? COLORS.cyan : COLORS.red;

      view.ring.clear();
      if (u.id === this.selectedId) view.ring.circle(0, 0, TILE_PX * 0.46).stroke({ width: 2, color });
      if (u.attention === 'path-complete' && u.faction === 'friendly')
        view.ring.circle(0, 0, TILE_PX * 0.52).stroke({ width: 1, color: COLORS.orange, alpha: 0.7 });

      view.body.clear();
      view.body.circle(0, 0, TILE_PX * 0.3).fill(color);
      // facing tick
      view.body
        .moveTo(0, 0)
        .lineTo(u.facing.x * TILE_PX * 0.42, u.facing.y * TILE_PX * 0.42)
        .stroke({ width: 2, color: COLORS.navy, alpha: 0.6 });
      // hp pip
      const w = TILE_PX * 0.7;
      view.body.rect(-w / 2, TILE_PX * 0.4, w, 3).fill(COLORS.wall);
      view.body.rect(-w / 2, TILE_PX * 0.4, (w * Math.max(0, u.hp)) / u.maxHp, 3).fill(color);

      if (u.faction === 'friendly') {
        const n = this.world.units.filter((x) => x.faction === 'friendly').indexOf(u) + 1;
        view.label.text = String(n);
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
      needsAttention: u.attention != null,
      visible: u.faction === 'friendly' || this.isVisible(u),
      status: this.statusOf(u),
    }));
    this.onSnapshot({
      paused: this.paused,
      time: this.world.time,
      missionName: this.mission.name,
      selectedId: this.selectedId,
      units,
      log: this.log.slice(-8),
    });
  }

  private statusOf(u: Unit): string {
    if (!u.alive) return 'K.I.A.';
    if (u.faction === 'hostile') return this.isVisible(u) ? 'CONTACT' : 'UNKNOWN';
    if (u.order.kind === 'move' && u.order.index < u.order.path.length)
      return this.paused ? 'ORDERS SET' : 'MOVING';
    if (u.attention === 'path-complete') return 'IN POSITION';
    return 'HOLDING';
  }
}
