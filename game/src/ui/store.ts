import { create } from 'zustand';
import type { Engine, Snapshot } from '../game/engine';

// Thin bridge: the engine pushes throttled snapshots in; React reads them out and
// calls engine commands. React never runs per-frame — Pixi owns the viewport.
interface UIState {
  engine: Engine | null;
  snapshot: Snapshot | null;
  setEngine: (e: Engine | null) => void;
  setSnapshot: (s: Snapshot) => void;
}

export const useGame = create<UIState>((set) => ({
  engine: null,
  snapshot: null,
  setEngine: (engine) => set({ engine }),
  setSnapshot: (snapshot) => set({ snapshot }),
}));
