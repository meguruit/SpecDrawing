import { create } from "zustand";
import type { Scene } from "@/lib/scenes/types";
import type { Part, PartId } from "@/lib/parts/types";
import type {
  FinishOption,
  FinishOptionId,
  SheetName,
} from "@/lib/finishes/schema";

export type PartFinishSelections = Record<PartId, FinishOptionId>;

type Notification = {
  id: number;
  message: string;
};

type CanvasState = {
  activeScene: Scene | null;
  parts: Part[];
  finishOptions: FinishOption[];
  selectedPartId: PartId | null;
  partFinishSelections: PartFinishSelections;
  activeOptionSheet: SheetName;
  markersVisible: boolean;
  exportRequestedAt: number;
  notification: Notification | null;

  loadScene: (
    scene: Scene,
    parts: Part[],
    finishOptions: FinishOption[],
    defaultSheet: SheetName,
  ) => void;
  selectPart: (partId: PartId | null) => void;
  clearSelection: () => void;
  setFinish: (partId: PartId, optionId: FinishOptionId) => void;
  clearFinish: (partId: PartId) => void;
  setActiveSheet: (sheet: SheetName) => void;
  toggleMarkers: () => void;
  requestExport: () => void;
  dismissNotification: () => void;
};

let nextNoteId = 1;

export const useCanvasStore = create<CanvasState>((set, get) => ({
  activeScene: null,
  parts: [],
  finishOptions: [],
  selectedPartId: null,
  partFinishSelections: {},
  activeOptionSheet: "",
  markersVisible: true,
  exportRequestedAt: 0,
  notification: null,

  loadScene: (scene, parts, finishOptions, defaultSheet) =>
    set({
      activeScene: scene,
      parts,
      finishOptions,
      selectedPartId: null,
      partFinishSelections: {},
      activeOptionSheet: defaultSheet,
      notification: null,
    }),

  selectPart: (partId) => set({ selectedPartId: partId }),
  clearSelection: () => set({ selectedPartId: null }),

  setFinish: (partId, optionId) => {
    const { parts, finishOptions, partFinishSelections } = get();
    const part = parts.find((p) => p.id === partId);
    if (!part) {
      console.warn(
        `[canvas store] rejecting setFinish: part "${partId}" not declared by active scene`,
      );
      return;
    }
    const option = finishOptions.find((o) => o.id === optionId);
    if (!option) {
      console.warn(
        `[canvas store] rejecting setFinish: option "${optionId}" not in catalog`,
      );
      return;
    }
    if (option.partId !== partId) {
      console.warn(
        `[canvas store] rejecting setFinish: option "${optionId}" belongs to part "${option.partId}", not "${partId}"`,
      );
      return;
    }
    if (part.renderMode === "color" && !option.colorHex) {
      console.warn(
        `[canvas store] rejecting setFinish: part "${partId}" is color-mode but option "${optionId}" has no colorHex`,
      );
      return;
    }
    if (part.renderMode === "texture" && !option.textureUrl) {
      console.warn(
        `[canvas store] rejecting setFinish: part "${partId}" is texture-mode but option "${optionId}" has no textureUrl`,
      );
      return;
    }
    set({
      partFinishSelections: { ...partFinishSelections, [partId]: optionId },
    });
  },

  clearFinish: (partId) =>
    set((s) => {
      if (!(partId in s.partFinishSelections)) return s;
      const next = { ...s.partFinishSelections };
      delete next[partId];
      return { partFinishSelections: next };
    }),

  setActiveSheet: (sheet) => {
    const { activeOptionSheet, finishOptions, partFinishSelections } = get();
    if (sheet === activeOptionSheet) return;
    // Preserve selections by (partId, label) match across sheets.
    const optionById = new Map(finishOptions.map((o) => [o.id, o]));
    const cleared: string[] = [];
    const next: PartFinishSelections = {};
    for (const [partId, optId] of Object.entries(partFinishSelections)) {
      const prev = optionById.get(optId);
      if (!prev) {
        cleared.push(partId);
        continue;
      }
      const match = finishOptions.find(
        (o) => o.partId === partId && o.sheet === sheet && o.label === prev.label,
      );
      if (match) {
        next[partId] = match.id;
      } else {
        cleared.push(partId);
      }
    }
    const update: Partial<CanvasState> = {
      activeOptionSheet: sheet,
      partFinishSelections: next,
    };
    if (cleared.length) {
      update.notification = {
        id: nextNoteId++,
        message: `シート切替で次の部材の選択が解除されました: ${cleared
          .map((id) => `#${id}`)
          .join(", ")}`,
      };
    }
    set(update);
  },

  toggleMarkers: () => set((s) => ({ markersVisible: !s.markersVisible })),

  requestExport: () => set({ exportRequestedAt: Date.now() }),

  dismissNotification: () => set({ notification: null }),
}));
