import type { CubeSample, CubismPhase } from "./types.ts";

export const CUBISM_FOV = 45;

export function cameraDistance(viewportHeight: number): number {
  const fovRadians = (CUBISM_FOV * Math.PI) / 180;
  return viewportHeight / 2 / Math.tan(fovRadians / 2);
}

export type ItemRuntime = {
  id: number;
  revision: number;
  button: HTMLButtonElement | null;
  samples: CubeSample[];
  width: number;
  height: number;
  columns: number;
  shatterMs: number;
  phase: CubismPhase;
  progress: number;
  pointerX: number;
  pointerY: number;
  clickX: number;
  clickY: number;
  shatterElapsed: number;
  reduced: boolean;
  onShatter: () => void;
};

let nextId = 1;
let entries: ItemRuntime[] = [];
let snapshot: readonly ItemRuntime[] = entries;
const listeners = new Set<() => void>();

export function createRuntime(): ItemRuntime {
  return {
    id: nextId++,
    revision: 0,
    button: null,
    samples: [],
    width: 0,
    height: 0,
    columns: 28,
    shatterMs: 1100,
    phase: "idle",
    progress: 0,
    pointerX: 0,
    pointerY: 0,
    clickX: 0,
    clickY: 0,
    shatterElapsed: 0,
    reduced: false,
    onShatter: () => {},
  };
}

function publish() {
  snapshot = entries.slice();
  for (const listener of listeners) listener();
}

export function registerRuntime(runtime: ItemRuntime) {
  entries = [...entries, runtime];
  publish();
  return () => {
    entries = entries.filter((entry) => entry.id !== runtime.id);
    publish();
  };
}

export function publishRuntime() {
  publish();
}

export function subscribeRuntimes(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRuntimes() {
  return snapshot;
}
