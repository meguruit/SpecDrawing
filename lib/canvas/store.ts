import { create } from "zustand";
import type { Scene } from "@/lib/scenes/types";
import type { Part, PartId } from "@/lib/parts/types";
import type {
  FinishOption,
  FinishOptionId,
  SheetName,
  SheetsManifest,
} from "@/lib/finishes/schema";
import { formatExportTimestamp } from "@/lib/export/filename";

export type PartFinishSelections = Record<PartId, FinishOptionId>;

type Notification = {
  id: number;
  message: string;
};

type CanvasState = {
  activeScene: Scene | null;
  parts: Part[];
  finishOptions: FinishOption[];
  sheetsManifest: SheetsManifest;
  /** Cache-bust hash for option textureUrls; bumped when finish-options.json changes. */
  finishOptionsRev: string;
  selectedPartId: PartId | null;
  partFinishSelections: PartFinishSelections;
  activeOptionSheet: SheetName;
  /** Active variant key when the active sheet has variantsEnabled === true; null otherwise. */
  activeVariantKey: string | null;
  /** Per-sheet remembered variant key, so a sheet round-trip restores the user's pick. */
  variantKeyBySheet: Record<SheetName, string>;
  markersVisible: boolean;
  exportRequestedAt: number;
  /** Shared timestamp string for the in-flight export click, so PNG and Excel filenames match. */
  exportTimestamp: string | null;
  notification: Notification | null;

  loadScene: (
    scene: Scene,
    parts: Part[],
    finishOptions: FinishOption[],
    defaultSheet: SheetName,
    finishOptionsRev: string,
    sheetsManifest: SheetsManifest,
  ) => void;
  selectPart: (partId: PartId | null) => void;
  clearSelection: () => void;
  setFinish: (partId: PartId, optionId: FinishOptionId) => void;
  clearFinish: (partId: PartId) => void;
  setActiveSheet: (sheet: SheetName) => void;
  setActiveVariantKey: (key: string) => void;
  toggleMarkers: () => void;
  requestExport: () => void;
  dismissNotification: () => void;
};

function resolveVariantKeyForSheet(
  scene: Scene,
  manifest: SheetsManifest,
  sheet: SheetName,
  remembered: Record<SheetName, string>,
): string | null {
  const sheetCfg = manifest.sheets.find((s) => s.key === sheet);
  if (!sheetCfg?.variantsEnabled) return null;
  if (scene.variants.length === 0) return null;
  const variantKeys = new Set(scene.variants.map((v) => v.key));
  const recalled = remembered[sheet];
  if (recalled && variantKeys.has(recalled)) return recalled;
  const def = sheetCfg.defaultVariantKey;
  if (def && variantKeys.has(def)) return def;
  return scene.variants[0]?.key ?? null;
}

let nextNoteId = 1;

export const useCanvasStore = create<CanvasState>((set, get) => ({
  activeScene: null,
  parts: [],
  finishOptions: [],
  sheetsManifest: { version: 1, sheets: [] },
  finishOptionsRev: "",
  selectedPartId: null,
  partFinishSelections: {},
  activeOptionSheet: "",
  activeVariantKey: null,
  variantKeyBySheet: {},
  markersVisible: true,
  exportRequestedAt: 0,
  exportTimestamp: null,
  notification: null,

  loadScene: (scene, parts, finishOptions, defaultSheet, finishOptionsRev, sheetsManifest) => {
    const variantKey = resolveVariantKeyForSheet(
      scene,
      sheetsManifest,
      defaultSheet,
      {},
    );
    set({
      activeScene: scene,
      parts,
      finishOptions,
      sheetsManifest,
      finishOptionsRev,
      selectedPartId: null,
      partFinishSelections: {},
      activeOptionSheet: defaultSheet,
      activeVariantKey: variantKey,
      variantKeyBySheet: variantKey ? { [defaultSheet]: variantKey } : {},
      notification: null,
    });
  },

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
    const {
      activeScene,
      activeOptionSheet,
      activeVariantKey,
      finishOptions,
      partFinishSelections,
      sheetsManifest,
      variantKeyBySheet,
    } = get();
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
    // Remember the variant key for the sheet we are leaving, so a round-trip
    // restores the user's pick.
    const rememberedNext: Record<SheetName, string> = { ...variantKeyBySheet };
    if (activeVariantKey) {
      rememberedNext[activeOptionSheet] = activeVariantKey;
    }
    const newVariantKey = activeScene
      ? resolveVariantKeyForSheet(activeScene, sheetsManifest, sheet, rememberedNext)
      : null;
    const update: Partial<CanvasState> = {
      activeOptionSheet: sheet,
      partFinishSelections: next,
      activeVariantKey: newVariantKey,
      variantKeyBySheet: rememberedNext,
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

  setActiveVariantKey: (key) => {
    const { activeScene, activeOptionSheet, sheetsManifest, variantKeyBySheet } = get();
    if (!activeScene) return;
    const sheetCfg = sheetsManifest.sheets.find((s) => s.key === activeOptionSheet);
    if (!sheetCfg?.variantsEnabled) return;
    const variantExists = activeScene.variants.some((v) => v.key === key);
    if (!variantExists) {
      console.warn(`[canvas store] rejecting setActiveVariantKey: "${key}" not in scene variants`);
      return;
    }
    set({
      activeVariantKey: key,
      variantKeyBySheet: { ...variantKeyBySheet, [activeOptionSheet]: key },
    });
  },

  toggleMarkers: () => set((s) => ({ markersVisible: !s.markersVisible })),

  requestExport: () =>
    set({
      exportRequestedAt: Date.now(),
      exportTimestamp: formatExportTimestamp(),
    }),

  dismissNotification: () => set({ notification: null }),
}));
