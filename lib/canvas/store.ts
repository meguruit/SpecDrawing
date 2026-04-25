import { create } from "zustand";
import type { Scene } from "@/lib/scenes/types";

export type PlacedMaterial = {
  instanceId: string;
  entryId: string;
  x: number;
  y: number;
  // creation order doubles as z-order (later = on top)
  createdAt: number;
};

export type ColorOverrides = Record<string, string | undefined>; // partId -> hex

type CanvasState = {
  activeScene: Scene | null;
  placedMaterials: PlacedMaterial[];
  colorOverrides: ColorOverrides;
  selectionId: string | null;
  exportRequestedAt: number;

  loadScene: (scene: Scene | null) => void;
  addMaterial: (entryId: string) => void;
  moveMaterial: (instanceId: string, x: number, y: number) => void;
  deleteMaterial: (instanceId: string) => void;
  select: (instanceId: string | null) => void;
  clearSelection: () => void;
  setPartColor: (partId: string, hex: string) => void;
  clearPartColor: (partId: string) => void;
  requestExport: () => void;
};

let nextSeq = 0;
const nextInstanceId = () => `m_${Date.now().toString(36)}_${(nextSeq++).toString(36)}`;

const DEFAULT_PLACEMENT = { x: 380, y: 220 };
const PLACEMENT_OFFSET = 32;

export const useCanvasStore = create<CanvasState>((set, get) => ({
  activeScene: null,
  placedMaterials: [],
  colorOverrides: {},
  selectionId: null,
  exportRequestedAt: 0,

  loadScene: (scene) =>
    set({
      activeScene: scene,
      placedMaterials: [],
      colorOverrides: {},
      selectionId: null,
    }),

  addMaterial: (entryId) => {
    const { placedMaterials } = get();
    const offsetIndex = placedMaterials.length;
    const placed: PlacedMaterial = {
      instanceId: nextInstanceId(),
      entryId,
      x: DEFAULT_PLACEMENT.x + offsetIndex * PLACEMENT_OFFSET,
      y: DEFAULT_PLACEMENT.y + offsetIndex * PLACEMENT_OFFSET,
      createdAt: Date.now(),
    };
    set({
      placedMaterials: [...placedMaterials, placed],
      selectionId: placed.instanceId,
    });
  },

  moveMaterial: (instanceId, x, y) =>
    set((s) => ({
      placedMaterials: s.placedMaterials.map((m) =>
        m.instanceId === instanceId ? { ...m, x, y } : m,
      ),
    })),

  deleteMaterial: (instanceId) =>
    set((s) => ({
      placedMaterials: s.placedMaterials.filter(
        (m) => m.instanceId !== instanceId,
      ),
      selectionId: s.selectionId === instanceId ? null : s.selectionId,
    })),

  select: (instanceId) => set({ selectionId: instanceId }),
  clearSelection: () => set({ selectionId: null }),

  setPartColor: (partId, hex) => {
    const { activeScene } = get();
    if (!activeScene) return;
    const declared = activeScene.parts.some((p) => p.id === partId);
    if (!declared) {
      // spec: reject silently — do not corrupt store with undeclared parts
      console.warn(
        `[canvas store] rejecting setPartColor: part "${partId}" not declared by scene "${activeScene.id}"`,
      );
      return;
    }
    set((s) => ({ colorOverrides: { ...s.colorOverrides, [partId]: hex } }));
  },

  clearPartColor: (partId) =>
    set((s) => {
      if (!(partId in s.colorOverrides)) return s;
      const next = { ...s.colorOverrides };
      delete next[partId];
      return { colorOverrides: next };
    }),

  requestExport: () => set({ exportRequestedAt: Date.now() }),
}));
