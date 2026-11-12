"use client";

import { create } from "zustand";

import { History } from "@/lib/polygon/history";
import type { RingAddress } from "@/lib/polygon/rings";
import * as db from "./db";
import {
  createProject,
  createZone,
  emptyExtras,
  newId,
  type ExteriorAngle,
  type ExteriorProject,
  type ExtrasCategory,
  type FacadeZone,
  type FinishTexture,
  type StoredImage,
} from "./types";
import type { Polygon } from "@/lib/parts/types";

// Exterior workspace state.
//
// Deliberately a *separate* store from the interior canvas: the two modes
// share no state, only pure helpers. Mixing projects/angles/zones into the
// interior store would couple two data models that change for different
// reasons — the interior one is driven by committed assets, this one by what
// the user just uploaded.

const PERSIST_DEBOUNCE_MS = 600;

export type Notification = { id: number; message: string };

/** Undo snapshot: the active angle's zones plus what was selected. */
type HistoryEntry = {
  angleId: string | null;
  zones: FacadeZone[];
  selectedZoneId: string | null;
};

type ExteriorState = {
  projects: ExteriorProject[];
  activeProjectId: string | null;
  activeAngleId: string | null;
  selectedZoneId: string | null;
  /** Ring receiving appended vertices. */
  activeRing: RingAddress;
  /** Object URL for the active angle's image, or null while loading. */
  imageUrl: string | null;
  /** True while a vertex drag is in flight, so the canvas can skip caching. */
  dragging: boolean;
  loading: boolean;
  notification: Notification | null;
  usage: db.StorageUsage | null;
  historyRev: number;

  init: () => Promise<void>;
  notify: (message: string) => void;
  dismissNotification: () => void;

  addProject: (name: string) => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  renameProject: (name: string) => void;

  addAngle: (image: StoredImage, label: string) => Promise<void>;
  selectAngle: (id: string) => Promise<void>;
  renameAngle: (id: string, label: string) => void;
  removeAngle: (id: string) => Promise<void>;

  selectZone: (id: string | null) => void;
  setActiveRing: (at: RingAddress) => void;
  addZone: (polygons: Polygon[]) => void;
  updateZoneGeometry: (id: string, polygons: Polygon[], opts?: { checkpoint?: boolean }) => void;
  patchZone: (id: string, patch: Partial<Omit<FacadeZone, "id">>) => void;
  removeZone: (id: string) => void;
  reorderZone: (id: string, direction: -1 | 1) => void;
  beginDrag: () => void;
  endDrag: () => void;

  setExtrasPrompt: (category: ExtrasCategory, prompt: string) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  refreshUsage: () => Promise<void>;
};

const history = new History<HistoryEntry>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let currentObjectUrl: string | null = null;

/** Replace the live object URL, revoking the previous one. */
function setObjectUrl(next: string | null): string | null {
  if (currentObjectUrl && currentObjectUrl !== next) {
    URL.revokeObjectURL(currentObjectUrl);
  }
  currentObjectUrl = next;
  return next;
}

export const useExteriorStore = create<ExteriorState>((set, get) => {
  /** Active project, or null. */
  const activeProject = (): ExteriorProject | null => {
    const { projects, activeProjectId } = get();
    return projects.find((p) => p.id === activeProjectId) ?? null;
  };

  const activeAngle = (): ExteriorAngle | null => {
    const p = activeProject();
    const { activeAngleId } = get();
    return p?.angles.find((a) => a.id === activeAngleId) ?? null;
  };

  /**
   * Apply a change to the active project, mark it dirty, and schedule a
   * debounced write. Only the project record is written — image blobs are
   * untouched, so dragging a vertex never rewrites megabytes.
   */
  const mutateProject = (fn: (p: ExteriorProject) => ExteriorProject): void => {
    const current = activeProject();
    if (!current) return;
    const next = { ...fn(current), updatedAt: Date.now() };
    set((s) => ({
      projects: s.projects.map((p) => (p.id === next.id ? next : p)),
    }));
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      db.putProject(next).catch((err) => {
        get().notify(`保存に失敗しました: ${(err as Error).message}`);
      });
    }, PERSIST_DEBOUNCE_MS);
  };

  const mutateAngle = (
    angleId: string,
    fn: (a: ExteriorAngle) => ExteriorAngle,
  ): void => {
    mutateProject((p) => ({
      ...p,
      angles: p.angles.map((a) => (a.id === angleId ? fn(a) : a)),
    }));
  };

  const snapshot = (): HistoryEntry => {
    const a = activeAngle();
    return {
      angleId: a?.id ?? null,
      // Deep-enough copy: zones are replaced wholesale on edit, but the
      // polygons array is shared, so clone it.
      zones: (a?.zones ?? []).map((z) => ({ ...z, polygons: z.polygons.map((poly) => ({
        outer: poly.outer.map((v) => [...v] as [number, number]),
        ...(poly.holes ? { holes: poly.holes.map((h) => h.map((v) => [...v] as [number, number])) } : {}),
      })) })),
      selectedZoneId: get().selectedZoneId,
    };
  };

  const pushHistory = (): void => {
    history.push(snapshot());
    set((s) => ({ historyRev: s.historyRev + 1 }));
  };

  const applyHistory = (entry: HistoryEntry): void => {
    if (!entry.angleId) return;
    mutateAngle(entry.angleId, (a) => ({ ...a, zones: entry.zones }));
    set({
      activeAngleId: entry.angleId,
      selectedZoneId: entry.selectedZoneId,
      historyRev: get().historyRev + 1,
    });
  };

  /** Load an angle's image into an object URL, revoking the previous one. */
  const loadAngleImage = async (angle: ExteriorAngle | null): Promise<void> => {
    if (!angle) {
      set({ imageUrl: setObjectUrl(null) });
      return;
    }
    const img = await db.getImage(angle.imageId);
    if (!img) {
      set({ imageUrl: setObjectUrl(null) });
      get().notify(`アングル「${angle.label}」の画像が見つかりません`);
      return;
    }
    // The angle may have changed while we awaited; only publish if still current.
    if (get().activeAngleId !== angle.id) return;
    set({ imageUrl: setObjectUrl(URL.createObjectURL(img.blob)) });
  };

  return {
    projects: [],
    activeProjectId: null,
    activeAngleId: null,
    selectedZoneId: null,
    activeRing: { kind: "outer", polygonIndex: 0 },
    imageUrl: null,
    dragging: false,
    loading: true,
    notification: null,
    usage: null,
    historyRev: 0,

    init: async () => {
      try {
        const projects = await db.listProjects();
        set({ projects, loading: false });
        if (projects.length > 0) await get().selectProject(projects[0].id);
        await get().refreshUsage();
        // Stored-but-unreadable records look exactly like deleted ones from
        // the user's side, so say so rather than leaving silent orphan bytes.
        const bad = db.unreadableProjects();
        if (bad.length > 0) {
          get().notify(
            `${bad.length} 件の案件を読み込めませんでした（${bad
              .map((b) => `${b.name}: ${b.reason}`)
              .join(" / ")}）。データは残っています。`,
          );
        }
      } catch (err) {
        set({ loading: false });
        get().notify(`読み込みに失敗しました: ${(err as Error).message}`);
      }
    },

    notify: (message) => set({ notification: { id: Date.now(), message } }),
    dismissNotification: () => set({ notification: null }),

    addProject: async (name) => {
      const project = createProject(name.trim(), Date.now());
      await db.putProject(project);
      history.clear();
      set((s) => ({
        projects: [project, ...s.projects],
        activeProjectId: project.id,
        activeAngleId: null,
        selectedZoneId: null,
        imageUrl: setObjectUrl(null),
        historyRev: s.historyRev + 1,
      }));
    },

    selectProject: async (id) => {
      const p = get().projects.find((x) => x.id === id);
      if (!p) return;
      history.clear();
      const first = p.angles[0] ?? null;
      set((s) => ({
        activeProjectId: id,
        activeAngleId: first?.id ?? null,
        selectedZoneId: null,
        activeRing: { kind: "outer", polygonIndex: 0 },
        historyRev: s.historyRev + 1,
      }));
      await loadAngleImage(first);
    },

    removeProject: async (id) => {
      const p = get().projects.find((x) => x.id === id);
      if (!p) return;
      await db.deleteProject(p);
      const rest = get().projects.filter((x) => x.id !== id);
      set({ projects: rest });
      if (get().activeProjectId === id) {
        set({ imageUrl: setObjectUrl(null), activeProjectId: null, activeAngleId: null });
        if (rest.length > 0) await get().selectProject(rest[0].id);
      }
      await get().refreshUsage();
    },

    renameProject: (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      mutateProject((p) => ({ ...p, name: trimmed }));
    },

    addAngle: async (image, label) => {
      await db.putImage(image);
      const angle: ExteriorAngle = {
        id: newId("ang"),
        label,
        imageId: image.id,
        filename: image.filename,
        width: image.width,
        height: image.height,
        zones: [],
      };
      mutateProject((p) => ({ ...p, angles: [...p.angles, angle] }));
      history.clear();
      set((s) => ({
        activeAngleId: angle.id,
        selectedZoneId: null,
        historyRev: s.historyRev + 1,
      }));
      await loadAngleImage(angle);
      await get().refreshUsage();
    },

    selectAngle: async (id) => {
      if (get().activeAngleId === id) return;
      const p = activeProject();
      const angle = p?.angles.find((a) => a.id === id) ?? null;
      history.clear();
      set((s) => ({
        activeAngleId: id,
        selectedZoneId: null,
        activeRing: { kind: "outer", polygonIndex: 0 },
        historyRev: s.historyRev + 1,
      }));
      await loadAngleImage(angle);
    },

    renameAngle: (id, label) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      mutateAngle(id, (a) => ({ ...a, label: trimmed }));
    },

    removeAngle: async (id) => {
      const p = activeProject();
      const angle = p?.angles.find((a) => a.id === id);
      if (!p || !angle) return;
      await db.deleteImage(angle.imageId).catch(() => undefined);
      const remaining = p.angles.filter((a) => a.id !== id);
      mutateProject((proj) => ({ ...proj, angles: remaining }));
      if (get().activeAngleId === id) {
        const next = remaining[0] ?? null;
        history.clear();
        set((s) => ({
          activeAngleId: next?.id ?? null,
          selectedZoneId: null,
          historyRev: s.historyRev + 1,
        }));
        await loadAngleImage(next);
      }
      await get().refreshUsage();
    },

    selectZone: (id) => {
      if (get().selectedZoneId === id) return;
      // A selection change is a checkpoint, so undo can step back across it.
      pushHistory();
      set({ selectedZoneId: id, activeRing: { kind: "outer", polygonIndex: 0 } });
    },

    setActiveRing: (at) => set({ activeRing: at }),

    addZone: (polygons) => {
      const a = activeAngle();
      if (!a) return;
      pushHistory();
      const zone = createZone(a.zones.length, polygons);
      mutateAngle(a.id, (ang) => ({ ...ang, zones: [...ang.zones, zone] }));
      set({ selectedZoneId: zone.id, activeRing: { kind: "outer", polygonIndex: 0 } });
    },

    updateZoneGeometry: (id, polygons, opts) => {
      const a = activeAngle();
      if (!a) return;
      // During a drag the caller suppresses checkpoints and pushes one on
      // release, so a hundred pointer-moves collapse into a single undo step.
      if (opts?.checkpoint !== false) pushHistory();
      mutateAngle(a.id, (ang) => ({
        ...ang,
        zones: ang.zones.map((z) => (z.id === id ? { ...z, polygons } : z)),
      }));
    },

    patchZone: (id, patch) => {
      const a = activeAngle();
      if (!a) return;
      pushHistory();
      mutateAngle(a.id, (ang) => ({
        ...ang,
        zones: ang.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)),
      }));
    },

    removeZone: (id) => {
      const a = activeAngle();
      if (!a) return;
      pushHistory();
      mutateAngle(a.id, (ang) => ({ ...ang, zones: ang.zones.filter((z) => z.id !== id) }));
      if (get().selectedZoneId === id) set({ selectedZoneId: null });
    },

    reorderZone: (id, direction) => {
      const a = activeAngle();
      if (!a) return;
      const idx = a.zones.findIndex((z) => z.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= a.zones.length) return;
      pushHistory();
      const zones = [...a.zones];
      [zones[idx], zones[target]] = [zones[target], zones[idx]];
      mutateAngle(a.id, (ang) => ({ ...ang, zones }));
    },

    beginDrag: () => {
      pushHistory();
      set({ dragging: true });
    },
    endDrag: () => set({ dragging: false }),

    setExtrasPrompt: (category, prompt) => {
      mutateProject((p) => {
        const extras = p.extras.length ? p.extras : emptyExtras();
        return {
          ...p,
          extras: extras.map((e) =>
            e.category === category ? { ...e, prompt, updatedAt: Date.now() } : e,
          ),
        };
      });
    },

    undo: () => {
      const entry = history.undo(snapshot());
      if (entry) applyHistory(entry);
    },
    redo: () => {
      const entry = history.redo(snapshot());
      if (entry) applyHistory(entry);
    },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),

    refreshUsage: async () => {
      const usage = await db.storageUsage();
      set({ usage });
    },
  };
});

/** Active project selector, for components. */
export function selectActiveProject(s: ExteriorState): ExteriorProject | null {
  return s.projects.find((p) => p.id === s.activeProjectId) ?? null;
}

/** Active angle selector, for components. */
export function selectActiveAngle(s: ExteriorState): ExteriorAngle | null {
  const p = selectActiveProject(s);
  return p?.angles.find((a) => a.id === s.activeAngleId) ?? null;
}

/** Selected zone selector, for components. */
export function selectSelectedZone(s: ExteriorState): FacadeZone | null {
  const a = selectActiveAngle(s);
  return a?.zones.find((z) => z.id === s.selectedZoneId) ?? null;
}

export type { FinishTexture };
