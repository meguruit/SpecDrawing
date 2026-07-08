import { create } from "zustand";
import type { Scene } from "@/lib/scenes/types";
import type { Part, PartId } from "@/lib/parts/types";
import type {
  FinishOption,
  FinishOptionId,
  PartSheetDefaults,
  SheetName,
  SheetsManifest,
} from "@/lib/finishes/schema";
import { resolveSheetDefault } from "@/lib/finishes/schema";
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
  /** Per-part per-sheet default selection from default-options.json (empty when absent). */
  partSheetDefaults: PartSheetDefaults;
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
    partSheetDefaults: PartSheetDefaults,
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
  partSheetDefaults: {},
  activeOptionSheet: "",
  activeVariantKey: null,
  variantKeyBySheet: {},
  markersVisible: true,
  exportRequestedAt: 0,
  exportTimestamp: null,
  notification: null,

  loadScene: (
    scene,
    parts,
    finishOptions,
    defaultSheet,
    finishOptionsRev,
    sheetsManifest,
    partSheetDefaults,
  ) => {
    const variantKey = resolveVariantKeyForSheet(
      scene,
      sheetsManifest,
      defaultSheet,
      {},
    );
    // Seed selections from the per-part effective default for the initial sheet
    // and base (base override ?? default); parts without a default for that
    // sheet start unselected.
    const seeded: PartFinishSelections = {};
    for (const part of parts) {
      const def = resolveSheetDefault(
        partSheetDefaults[part.id]?.[defaultSheet],
        variantKey,
      );
      if (def) seeded[part.id] = def;
    }
    set({
      activeScene: scene,
      parts,
      finishOptions,
      sheetsManifest,
      finishOptionsRev,
      partSheetDefaults,
      selectedPartId: null,
      partFinishSelections: seeded,
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
      parts,
      partFinishSelections,
      partSheetDefaults,
      sheetsManifest,
      variantKeyBySheet,
    } = get();
    if (sheet === activeOptionSheet) return;
    // Remember the variant key for the sheet we are leaving, so a round-trip
    // restores the user's pick, then resolve the base active on the new sheet —
    // the effective default depends on it.
    const rememberedNext: Record<SheetName, string> = { ...variantKeyBySheet };
    if (activeVariantKey) {
      rememberedNext[activeOptionSheet] = activeVariantKey;
    }
    const newVariantKey = activeScene
      ? resolveVariantKeyForSheet(activeScene, sheetsManifest, sheet, rememberedNext)
      : null;
    // Resolve each part's selection on the newly active sheet. A selection is
    // "explicit" when it differs from the part's effective default on the sheet
    // and base we are leaving; explicit picks are preserved by (partId, label)
    // match (falling to the new sheet's effective default, else cleared).
    // Non-explicit parts (at the old default, or untouched) simply adopt the new
    // sheet's effective default.
    const optionById = new Map(finishOptions.map((o) => [o.id, o]));
    const cleared: string[] = [];
    const next: PartFinishSelections = {};
    for (const part of parts) {
      const prevId = partFinishSelections[part.id];
      const oldDefault = resolveSheetDefault(
        partSheetDefaults[part.id]?.[activeOptionSheet],
        activeVariantKey,
      );
      const newDefault = resolveSheetDefault(
        partSheetDefaults[part.id]?.[sheet],
        newVariantKey,
      );
      const isExplicit = Boolean(prevId) && prevId !== oldDefault;
      if (isExplicit) {
        const prev = optionById.get(prevId);
        const match = prev
          ? finishOptions.find(
              (o) =>
                o.partId === part.id &&
                o.sheet === sheet &&
                o.label === prev.label,
            )
          : undefined;
        if (match) {
          next[part.id] = match.id;
        } else if (newDefault) {
          next[part.id] = newDefault;
        } else {
          cleared.push(part.id);
        }
      } else if (newDefault) {
        next[part.id] = newDefault;
      }
    }
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
    const {
      activeScene,
      activeOptionSheet,
      activeVariantKey,
      parts,
      partFinishSelections,
      partSheetDefaults,
      sheetsManifest,
      variantKeyBySheet,
    } = get();
    if (!activeScene) return;
    const sheetCfg = sheetsManifest.sheets.find((s) => s.key === activeOptionSheet);
    if (!sheetCfg?.variantsEnabled) return;
    const variantExists = activeScene.variants.some((v) => v.key === key);
    if (!variantExists) {
      console.warn(`[canvas store] rejecting setActiveVariantKey: "${key}" not in scene variants`);
      return;
    }
    // The effective default can differ per base. Re-resolve it for every part:
    // an at-default/untouched part follows the new base's default; an explicit
    // pick (selection differs from the old base's default) stays put. Same sheet
    // ⇒ same option set, so no label re-match and no clearing notification.
    const next: PartFinishSelections = { ...partFinishSelections };
    for (const part of parts) {
      const entry = partSheetDefaults[part.id]?.[activeOptionSheet];
      if (!entry) continue;
      const oldDefault = resolveSheetDefault(entry, activeVariantKey);
      const newDefault = resolveSheetDefault(entry, key);
      const prevId = partFinishSelections[part.id];
      const isExplicit = Boolean(prevId) && prevId !== oldDefault;
      if (isExplicit) continue;
      if (newDefault) next[part.id] = newDefault;
      else delete next[part.id];
    }
    set({
      activeVariantKey: key,
      variantKeyBySheet: { ...variantKeyBySheet, [activeOptionSheet]: key },
      partFinishSelections: next,
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
