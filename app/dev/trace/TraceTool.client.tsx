"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Line,
  Circle,
  Text,
} from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";

import { useImage } from "@/lib/canvas/useImageCache";
import {
  loadScenesIndex,
  loadScene,
  pickDefaultScene,
} from "@/lib/scenes/load";
import type { Scene } from "@/lib/scenes/types";
import type { Part, PartsManifest, Vertex } from "@/lib/parts/types";
import { deriveVariantMaskFilename } from "@/lib/parts/types";
import {
  firstOuter,
  getRingVertices,
  withRingVertices,
  appendPolygon,
  removePolygonAt,
  appendHole,
  removeHoleAt,
  type ActiveRing,
} from "@/lib/parts/polygonOps";
import {
  loadDraft,
  saveDraft,
  clearDraft,
} from "@/lib/dev/draftStore";
import { History, type HistoryEntry } from "@/lib/dev/history";
import { nearestEdge, type Point } from "@/lib/dev/geometry";
import { RestoreDraftPrompt } from "@/components/dev/RestoreDraftPrompt";
import {
  ExtractorImportPanel,
  type ExtractedManifest,
} from "@/components/dev/ExtractorImportPanel";

const MAX_DISPLAY_WIDTH = 1100;
const AUTOSAVE_DEBOUNCE_MS = 600;
const RETRY_INTERVAL_MS = 2000;
const RETRY_MAX_DURATION_MS = 60_000;
const EDGE_INSERT_TOLERANCE_PX = 12;
const VISIBILITY_KEY = "dev:trace:visibility";

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
function glyph(id: string): string {
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? CIRCLED[n - 1] : `#${id}`;
}

const CATEGORY_COLOR: Record<string, string> = {
  キッチン: "#F97316",
  照明: "#F59E0B",
  玄関: "#FBBF24",
  室内建具: "#3B82F6",
  床材: "#10B981",
  収納アクセント: "#F97316",
  サッシ: "#EF4444",
};

type Visibility = "all" | "current" | "hidden";
function isVisibility(v: unknown): v is Visibility {
  return v === "all" || v === "current" || v === "hidden";
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "validation-failed"; message: string }
  | { kind: "local-only"; since: number }
  | { kind: "preview-readonly" };

type RegenStatus =
  | { kind: "idle" }
  | { kind: "scheduled" }
  | { kind: "running" }
  | { kind: "done"; count: number; at: string }
  | { kind: "failed"; message: string }
  | { kind: "preview-readonly" };

const REGEN_DEBOUNCE_MS = 1500;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", { hour12: false });
  } catch {
    return iso;
  }
}

export default function TraceTool() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [manifest, setManifest] = useState<PartsManifest | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which mask layer is being edited: null = the shared base `polygons`
  // (drives hit-testing + marker); a variant key = that variant's
  // `maskPolygonsByVariant` entry (visual mask only). Only meaningful on
  // scenes that declare variants.
  const [editVariant, setEditVariant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [productionDisabled, setProductionDisabled] = useState(false);
  const [restorePrompt, setRestorePrompt] = useState<{
    diskMtime: string;
    draftSavedAt: string;
    diskManifest: PartsManifest;
    draftManifest: PartsManifest;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [regenStatus, setRegenStatus] = useState<RegenStatus>({ kind: "idle" });
  const regenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("all");
  const [importPanel, setImportPanel] = useState<{
    extracted: ExtractedManifest;
  } | null>(null);
  const [historyRev, setHistoryRev] = useState(0); // bump to re-render undo/redo buttons

  // Active ring being edited within `editingPart.polygons`. Defaults to the
  // first outer when a part is selected; reset whenever editingId changes.
  const [activeRing, setActiveRing] = useState<ActiveRing>({
    kind: "outer",
    polygonIndex: 0,
  });
  // While true, stage clicks build a new hole ring under the active outer.
  // Toggled off via Esc, the "穴を完了" button, or right-click on canvas.
  const [holeBuildMode, setHoleBuildMode] = useState(false);

  const stageRef = useRef<Konva.Stage>(null);
  const historyRef = useRef(new History());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryStartedAtRef = useRef<number | null>(null);
  // Latest manifest snapshot for autosave callbacks (avoids stale closures).
  const latestManifestRef = useRef<PartsManifest | null>(null);

  // The canvas base image follows the active edit variant so the designer
  // traces against the perspective the mask will be used on.
  const editBaseUrl = useMemo(() => {
    if (!scene) return undefined;
    if (!editVariant) return scene.baseImageUrl;
    return (
      scene.variants.find((v) => v.key === editVariant)?.baseImageUrl ??
      scene.baseImageUrl
    );
  }, [scene, editVariant]);
  const baseImage = useImage(editBaseUrl);

  // Load visibility preference once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(VISIBILITY_KEY);
      if (isVisibility(v)) setVisibility(v);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(VISIBILITY_KEY, visibility);
    } catch {
      // ignore
    }
  }, [visibility]);

  // Mount: load scene, fetch parts.json from dev API + check localStorage draft.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const index = await loadScenesIndex();
        const def = pickDefaultScene(index);
        const sc = await loadScene(def.manifestUrl);
        if (!alive) return;
        setScene(sc);

        const res = await fetch("/api/dev/parts", { cache: "no-store" });
        if (res.status === 404) {
          // Production deploys gate the dev API to 404 (see app/api/dev/parts/route.ts).
          // Surface a friendly placeholder instead of the generic error path.
          if (alive) setProductionDisabled(true);
          return;
        }
        if (!res.ok) {
          throw new Error(
            `dev API not reachable (status ${res.status}). Are you running \`npm run dev\`?`,
          );
        }
        const { manifest: diskManifest, mtime } = (await res.json()) as {
          manifest: PartsManifest;
          mtime: string;
        };

        const draft = loadDraft(sc.id);
        const draftIsNewer =
          draft &&
          new Date(draft.savedAt).getTime() >
            new Date(mtime).getTime() + 2000;

        if (!alive) return;
        if (draftIsNewer && draft) {
          setRestorePrompt({
            diskMtime: mtime,
            draftSavedAt: draft.savedAt,
            diskManifest,
            draftManifest: draft.manifest,
          });
          // Show disk version under the prompt until user decides.
          loadInitialManifest(sc.id, diskManifest, false);
        } else {
          loadInitialManifest(sc.id, diskManifest, true);
        }
      } catch (e: unknown) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadInitialManifest(
    sceneId: string,
    m: PartsManifest,
    clearDraftToo: boolean,
  ) {
    setManifest(m);
    latestManifestRef.current = m;
    if (m.parts.length) setEditingId((prev) => prev ?? m.parts[0].id);
    historyRef.current.clear();
    setHistoryRev((r) => r + 1);
    if (clearDraftToo) clearDraft(sceneId);
    setSaveStatus({ kind: "idle" });
  }

  // The raw part straight from the manifest (shared polygons + marker, plus
  // any per-variant overrides). Used by variant-management actions.
  const editingPartRaw: Part | undefined = useMemo(
    () => manifest?.parts.find((p) => p.id === editingId),
    [manifest, editingId],
  );

  // The part as the editor sees it: when a variant is active, its `.polygons`
  // is swapped for that variant's mask polygons — seeded from the shared
  // `polygons` until the designer's first edit creates an override. All the
  // editing ops + canvas rendering below read this view, so they work
  // identically on the base layer and on a variant layer.
  const editingPart: Part | undefined = useMemo(() => {
    if (!editingPartRaw) return undefined;
    if (!editVariant) return editingPartRaw;
    const target =
      editingPartRaw.maskPolygonsByVariant?.[editVariant] ??
      editingPartRaw.polygons;
    return { ...editingPartRaw, polygons: target };
  }, [editingPartRaw, editVariant]);

  // Whether the active part already has a committed override for the active
  // variant (vs. still showing the seeded base polygons).
  const variantOverrideExists = Boolean(
    editVariant && editingPartRaw?.maskPolygonsByVariant?.[editVariant],
  );

  // Reset ring focus + hole-build mode whenever the editing part or the
  // active variant changes (the polygon set under edit changed).
  useEffect(() => {
    setActiveRing({ kind: "outer", polygonIndex: 0 });
    setHoleBuildMode(false);
  }, [editingId, editVariant]);

  const displayScale = useMemo(
    () => (scene ? Math.min(1, MAX_DISPLAY_WIDTH / scene.width) : 1),
    [scene],
  );

  // Snapshot the editing part's current state (for history pushes).
  const snapshotCurrent = useCallback((): HistoryEntry | null => {
    if (!editingPart) return null;
    return {
      editingId: editingPart.id,
      editVariant,
      polygons: editingPart.polygons.map((poly) => ({
        outer: poly.outer.map((v) => [v[0], v[1]] as Vertex),
        holes: poly.holes?.map((h) =>
          h.map((v) => [v[0], v[1]] as Vertex),
        ),
      })),
      marker: { ...editingPart.marker },
    };
  }, [editingPart, editVariant]);

  // ----- autosave + retry plumbing -----

  // The autosave chain is scheduleAutosave → flushSave → (on failure)
  // startLocalOnlyMode → (retry) flushSave. To break the circular dep and
  // keep all three stable across renders, flushSave is held in a ref that
  // gets re-pointed when its dependencies (`scene`) change. scheduleAutosave
  // and startLocalOnlyMode are then empty-deps useCallbacks that read the
  // current flushSave through the ref.

  const flushSaveRef = useRef<() => Promise<void>>(async () => {});

  const startLocalOnlyMode = useCallback(() => {
    const now = Date.now();
    if (retryStartedAtRef.current === null) retryStartedAtRef.current = now;
    setSaveStatus({ kind: "local-only", since: retryStartedAtRef.current });
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (now - retryStartedAtRef.current >= RETRY_MAX_DURATION_MS) {
      retryTimerRef.current = null;
      return;
    }
    retryTimerRef.current = setTimeout(() => {
      void flushSaveRef.current();
    }, RETRY_INTERVAL_MS);
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void flushSaveRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  // Regen runs after the autosave settles. We use a longer debounce so a
  // burst of edits collapses into a single regen run.
  const runRegen = useCallback(async (force: boolean) => {
    setRegenStatus({ kind: "running" });
    try {
      const url = force
        ? "/api/dev/parts/regen?force=true"
        : "/api/dev/parts/regen";
      const res = await fetch(url, { method: "POST" });
      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (body.error === "preview-readonly") {
          setRegenStatus({ kind: "preview-readonly" });
          return;
        }
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setRegenStatus({
          kind: "failed",
          message: body.message ?? `regen failed (${res.status})`,
        });
        return;
      }
      const body = (await res.json()) as { regenerated: string[] };
      setRegenStatus({
        kind: "done",
        count: body.regenerated.length,
        at: new Date().toISOString(),
      });
    } catch (e: unknown) {
      setRegenStatus({
        kind: "failed",
        message: (e as Error).message,
      });
    }
  }, []);

  const scheduleRegen = useCallback(() => {
    if (regenTimerRef.current) clearTimeout(regenTimerRef.current);
    setRegenStatus({ kind: "scheduled" });
    regenTimerRef.current = setTimeout(() => {
      void runRegen(false);
    }, REGEN_DEBOUNCE_MS);
  }, [runRegen]);

  const handleRegenAll = useCallback(() => {
    if (regenTimerRef.current) clearTimeout(regenTimerRef.current);
    void runRegen(true);
  }, [runRegen]);

  useEffect(() => {
    flushSaveRef.current = async () => {
      const m = latestManifestRef.current;
      if (!m || !scene) return;
      setSaveStatus({ kind: "saving" });
      try {
        const res = await fetch("/api/dev/parts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(m),
        });
        if (res.status === 422) {
          const body = (await res.json().catch(() => ({}))) as {
            field?: string;
            message?: string;
          };
          setSaveStatus({
            kind: "validation-failed",
            message: `${body.field ?? "?"}: ${body.message ?? "validation failed"}`,
          });
          return;
        }
        if (res.status === 503) {
          // Vercel preview deploys mark the API as read-only; surface a
          // distinct, terminal status (no retry) so the user heads to the
          // ダウンロード → commit workflow.
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (body.error === "preview-readonly") {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
            retryStartedAtRef.current = null;
            setSaveStatus({ kind: "preview-readonly" });
            return;
          }
        }
        if (!res.ok) {
          startLocalOnlyMode();
          return;
        }
        const { savedAt } = (await res.json()) as { savedAt: string };
        setSaveStatus({ kind: "saved", at: savedAt });
        clearDraft(scene.id);
        retryStartedAtRef.current = null;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
        scheduleRegen();
      } catch {
        startLocalOnlyMode();
      }
    };
  }, [scene, startLocalOnlyMode, scheduleRegen]);

  // Push a "before" snapshot to the undo stack, then apply a manifest
  // mutation, mirror to localStorage, and trigger autosave.
  const commit = useCallback(
    (
      newManifest: PartsManifest,
      options: { pushBefore?: HistoryEntry | null } = {},
    ) => {
      if (options.pushBefore) {
        historyRef.current.push(options.pushBefore);
        setHistoryRev((r) => r + 1);
      }
      setManifest(newManifest);
      latestManifestRef.current = newManifest;
      if (scene) saveDraft(scene.id, newManifest);
      scheduleAutosave();
    },
    [scene, scheduleAutosave],
  );

  const updatePart = useCallback(
    (
      id: string,
      mutator: (p: Part) => Part,
      pushBefore: HistoryEntry | null,
    ) => {
      if (!manifest) return;
      const next: PartsManifest = {
        ...manifest,
        parts: manifest.parts.map((p) => {
          if (p.id !== id) return p;
          if (!editVariant) return mutator(p);
          // Editing a variant: run the mutator against the variant's mask
          // polygons (seeded from base on first touch), then route ONLY the
          // resulting polygons into maskPolygonsByVariant — the shared
          // `polygons` and `marker` (hit-test/marker) are left untouched.
          const target =
            p.maskPolygonsByVariant?.[editVariant] ?? p.polygons;
          const mutated = mutator({ ...p, polygons: target });
          return {
            ...p,
            maskByVariant: {
              ...p.maskByVariant,
              [editVariant]:
                p.maskByVariant?.[editVariant] ??
                deriveVariantMaskFilename(p.mask, editVariant),
            },
            maskPolygonsByVariant: {
              ...p.maskPolygonsByVariant,
              [editVariant]: mutated.polygons,
            },
          };
        }),
      };
      commit(next, { pushBefore });
    },
    [manifest, commit, editVariant],
  );

  // Cleanup pending timers on unmount.
  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (regenTimerRef.current) clearTimeout(regenTimerRef.current);
    },
    [],
  );

  // ----- editing actions -----

  const handleAddVertex = useCallback(
    (x: number, y: number, target: ActiveRing = activeRing) => {
      if (!editingPart) return;
      const before = snapshotCurrent();
      updatePart(
        editingPart.id,
        (p) =>
          withRingVertices(p, target, [
            ...getRingVertices(p, target),
            [Math.round(x), Math.round(y)],
          ]),
        before,
      );
    },
    [editingPart, activeRing, snapshotCurrent, updatePart],
  );

  const handleInsertVertexAt = useCallback(
    (edgeIndex: number, foot: Point, target: ActiveRing = activeRing) => {
      if (!editingPart) return;
      const before = snapshotCurrent();
      updatePart(
        editingPart.id,
        (p) => {
          const next = getRingVertices(p, target).slice();
          next.splice(edgeIndex + 1, 0, [
            Math.round(foot[0]),
            Math.round(foot[1]),
          ]);
          return withRingVertices(p, target, next);
        },
        before,
      );
    },
    [editingPart, activeRing, snapshotCurrent, updatePart],
  );

  const handleMoveVertexLive = useCallback(
    (target: ActiveRing, idx: number, x: number, y: number) => {
      if (!editingPart) return;
      // Live drag — no history push, just state update + draft mirror.
      updatePart(
        editingPart.id,
        (p) => {
          const next = getRingVertices(p, target).slice();
          next[idx] = [Math.round(x), Math.round(y)];
          return withRingVertices(p, target, next);
        },
        null,
      );
    },
    [editingPart, updatePart],
  );

  // Capture pre-drag state at mousedown so dragend can push it to history.
  const dragSnapshotRef = useRef<HistoryEntry | null>(null);
  const beginDrag = useCallback(() => {
    dragSnapshotRef.current = snapshotCurrent();
  }, [snapshotCurrent]);
  const endDrag = useCallback(() => {
    if (dragSnapshotRef.current) {
      historyRef.current.push(dragSnapshotRef.current);
      setHistoryRev((r) => r + 1);
      dragSnapshotRef.current = null;
    }
  }, []);

  const handleDeleteVertex = useCallback(
    (target: ActiveRing, idx: number) => {
      if (!editingPart) return;
      const before = snapshotCurrent();
      updatePart(
        editingPart.id,
        (p) =>
          withRingVertices(
            p,
            target,
            getRingVertices(p, target).filter((_, i) => i !== idx),
          ),
        before,
      );
    },
    [editingPart, snapshotCurrent, updatePart],
  );

  const handleMoveMarkerLive = useCallback(
    (x: number, y: number) => {
      if (!editingPart) return;
      // Marker belongs to the shared part, not to any variant — ignore drags
      // while a variant layer is active (the marker is non-draggable then,
      // this is just belt-and-suspenders).
      if (editVariant) return;
      updatePart(
        editingPart.id,
        (p) => ({
          ...p,
          marker: { x: Math.round(x), y: Math.round(y) },
        }),
        null,
      );
    },
    [editingPart, updatePart, editVariant],
  );

  const handleClearActiveRing = useCallback(() => {
    if (!editingPart) return;
    const before = snapshotCurrent();
    updatePart(editingPart.id, (p) => withRingVertices(p, activeRing, []), before);
  }, [editingPart, activeRing, snapshotCurrent, updatePart]);

  // Append a new outer (sub-polygon) and focus it for editing.
  const handleAddPolygon = useCallback(() => {
    if (!editingPart) return;
    const before = snapshotCurrent();
    const nextIndex = editingPart.polygons.length;
    updatePart(editingPart.id, (p) => appendPolygon(p), before);
    setActiveRing({ kind: "outer", polygonIndex: nextIndex });
    setHoleBuildMode(false);
  }, [editingPart, snapshotCurrent, updatePart]);

  // Remove the polygon entry the active ring lives in. Refuses to remove
  // the last remaining polygon — every part must have ≥ 1 outer.
  const handleRemoveActivePolygon = useCallback(() => {
    if (!editingPart) return;
    if (editingPart.polygons.length <= 1) return;
    const before = snapshotCurrent();
    const idx = activeRing.polygonIndex;
    updatePart(editingPart.id, (p) => removePolygonAt(p, idx), before);
    setActiveRing({ kind: "outer", polygonIndex: 0 });
    setHoleBuildMode(false);
  }, [editingPart, activeRing.polygonIndex, snapshotCurrent, updatePart]);

  // Start building a hole inside the active polygon's outer.
  const handleAddHole = useCallback(() => {
    if (!editingPart) return;
    const before = snapshotCurrent();
    const polygonIndex = activeRing.polygonIndex;
    const poly = editingPart.polygons[polygonIndex];
    const nextHoleIndex = poly?.holes?.length ?? 0;
    updatePart(editingPart.id, (p) => appendHole(p, polygonIndex), before);
    setActiveRing({ kind: "hole", polygonIndex, holeIndex: nextHoleIndex });
    setHoleBuildMode(true);
  }, [editingPart, activeRing.polygonIndex, snapshotCurrent, updatePart]);

  // End hole-build mode without removing the in-progress hole. Falls back
  // to editing the parent outer.
  const handleEndHole = useCallback(() => {
    setHoleBuildMode(false);
    if (activeRing.kind === "hole") {
      setActiveRing({ kind: "outer", polygonIndex: activeRing.polygonIndex });
    }
  }, [activeRing]);

  // Remove a specific hole. Pushes one undo entry.
  const handleRemoveHole = useCallback(
    (polygonIndex: number, holeIndex: number) => {
      if (!editingPart) return;
      const before = snapshotCurrent();
      updatePart(
        editingPart.id,
        (p) => removeHoleAt(p, polygonIndex, holeIndex),
        before,
      );
      if (
        activeRing.kind === "hole" &&
        activeRing.polygonIndex === polygonIndex &&
        activeRing.holeIndex === holeIndex
      ) {
        setActiveRing({ kind: "outer", polygonIndex });
        setHoleBuildMode(false);
      }
    },
    [editingPart, activeRing, snapshotCurrent, updatePart],
  );

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Konva fires `click` for any mouse button. Right-click is handled
      // per-vertex by `onContextMenu`; if we don't bail here, the post-
      // delete click re-inserts a vertex right next to the deleted one.
      if ("button" in e.evt && e.evt.button !== 0) return;
      if (e.target !== e.target.getStage()) return;
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos || !editingPart) return;
      const sx = pos.x / displayScale;
      const sy = pos.y / displayScale;
      const tol = EDGE_INSERT_TOLERANCE_PX / displayScale;

      // Hole-build mode: clicks always go to the in-progress hole. Edge-
      // midpoint insertion only considers that hole's edges.
      if (holeBuildMode && activeRing.kind === "hole") {
        const ringVerts = getRingVertices(editingPart, activeRing);
        const hit = nearestEdge(ringVerts as ReadonlyArray<Point>, [sx, sy], tol);
        if (hit) handleInsertVertexAt(hit.edgeIndex, hit.foot, activeRing);
        else handleAddVertex(sx, sy, activeRing);
        return;
      }

      // Normal mode: scan every ring of the editing part; the nearest edge
      // wins regardless of which sub-polygon is currently active. The
      // matched ring also becomes the new active ring so subsequent
      // clicks build coherently.
      let best: { active: ActiveRing; edgeIndex: number; foot: Point; distance: number } | null = null;
      editingPart.polygons.forEach((poly, pi) => {
        const outer = nearestEdge(poly.outer as ReadonlyArray<Point>, [sx, sy], tol);
        if (outer && (!best || outer.distance < best.distance)) {
          best = {
            active: { kind: "outer", polygonIndex: pi },
            edgeIndex: outer.edgeIndex,
            foot: outer.foot,
            distance: outer.distance,
          };
        }
        poly.holes?.forEach((h, hi) => {
          const inner = nearestEdge(h as ReadonlyArray<Point>, [sx, sy], tol);
          if (inner && (!best || inner.distance < best.distance)) {
            best = {
              active: { kind: "hole", polygonIndex: pi, holeIndex: hi },
              edgeIndex: inner.edgeIndex,
              foot: inner.foot,
              distance: inner.distance,
            };
          }
        });
      });

      if (best) {
        const hit = best as {
          active: ActiveRing;
          edgeIndex: number;
          foot: Point;
        };
        handleInsertVertexAt(hit.edgeIndex, hit.foot, hit.active);
        setActiveRing(hit.active);
      } else {
        // Fall through: append to the active ring (default = active outer).
        handleAddVertex(sx, sy, activeRing);
      }
    },
    [
      editingPart,
      displayScale,
      activeRing,
      holeBuildMode,
      handleInsertVertexAt,
      handleAddVertex,
    ],
  );

  // ----- editing-part switch (history checkpoint) -----

  const handleSelectPart = useCallback(
    (id: string) => {
      if (id === editingId) return;
      const before = snapshotCurrent();
      if (before) {
        historyRef.current.push(before);
        setHistoryRev((r) => r + 1);
      }
      setEditingId(id);
    },
    [editingId, snapshotCurrent],
  );

  // ----- variant layer switch -----

  // Switch which mask layer is being edited. `key === null` selects the base
  // layer (shared polygons + marker); a variant key selects that variant's
  // mask polygons (seeded from base until first edit). A history checkpoint
  // is pushed so undo can step back across the switch.
  const handleSelectVariant = useCallback(
    (key: string | null) => {
      if (key === editVariant) return;
      const before = snapshotCurrent();
      if (before) {
        historyRef.current.push(before);
        setHistoryRev((r) => r + 1);
      }
      setEditVariant(key);
    },
    [editVariant, snapshotCurrent],
  );

  // Drop the active variant's override (mask polygons + filename) and revert
  // that variant to the part's base mask. Pushes one undo entry.
  const handleRemoveVariantOverride = useCallback(() => {
    if (!editingPartRaw || !editVariant || !manifest) return;
    const key = editVariant;
    const before = snapshotCurrent();
    const next: PartsManifest = {
      ...manifest,
      parts: manifest.parts.map((p) => {
        if (p.id !== editingPartRaw.id) return p;
        const mbv = { ...(p.maskByVariant ?? {}) };
        const mpbv = { ...(p.maskPolygonsByVariant ?? {}) };
        delete mbv[key];
        delete mpbv[key];
        return {
          ...p,
          maskByVariant: Object.keys(mbv).length ? mbv : undefined,
          maskPolygonsByVariant: Object.keys(mpbv).length ? mpbv : undefined,
        };
      }),
    };
    setEditVariant(null);
    commit(next, { pushBefore: before });
  }, [editingPartRaw, editVariant, manifest, snapshotCurrent, commit]);

  // ----- undo / redo -----

  const applyHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      if (!manifest) return;
      // Restore the layer the snapshot was taken on before applying it.
      if (entry.editVariant !== editVariant) {
        setEditVariant(entry.editVariant);
      }
      // If the entry's editingId differs, switch parts first (no further push).
      if (entry.editingId !== editingId) {
        setEditingId(entry.editingId);
      }
      if (!entry.editingId) {
        // No-op; nothing to apply.
        return;
      }
      const id = entry.editingId;
      const restoredPolygons = entry.polygons.map((poly) => ({
        outer: poly.outer.map((v) => [v[0], v[1]] as Vertex),
        holes: poly.holes?.map((h) => h.map((v) => [v[0], v[1]] as Vertex)),
      }));
      const next: PartsManifest = {
        ...manifest,
        parts: manifest.parts.map((p) => {
          if (p.id !== id) return p;
          if (!entry.editVariant) {
            // Base layer: restore shared polygons + marker.
            return {
              ...p,
              polygons: restoredPolygons,
              marker: { ...entry.marker },
            };
          }
          // Variant layer: restore that variant's mask polygons only.
          return {
            ...p,
            maskByVariant: {
              ...p.maskByVariant,
              [entry.editVariant]:
                p.maskByVariant?.[entry.editVariant] ??
                deriveVariantMaskFilename(p.mask, entry.editVariant),
            },
            maskPolygonsByVariant: {
              ...p.maskPolygonsByVariant,
              [entry.editVariant]: restoredPolygons,
            },
          };
        }),
      };
      commit(next);
    },
    [manifest, editingId, editVariant, commit],
  );

  const undo = useCallback(() => {
    const current = snapshotCurrent();
    if (!current) return;
    const prev = historyRef.current.undo(current);
    setHistoryRev((r) => r + 1);
    if (prev) applyHistoryEntry(prev);
  }, [snapshotCurrent, applyHistoryEntry]);

  const redo = useCallback(() => {
    const current = snapshotCurrent();
    if (!current) return;
    const next = historyRef.current.redo(current);
    setHistoryRev((r) => r + 1);
    if (next) applyHistoryEntry(next);
  }, [snapshotCurrent, applyHistoryEntry]);

  // Keyboard bindings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Esc ends hole-build mode without removing the in-progress hole.
      if (e.key === "Escape" && holeBuildMode) {
        e.preventDefault();
        handleEndHole();
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, holeBuildMode, handleEndHole]);

  // ----- extractor import -----

  const handleOpenImport = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/parts?source=extracted", {
        cache: "no-store",
      });
      if (res.status === 404) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(
          body.message ??
            "/tmp/parts-extracted.json が見つかりません。先に `node scripts/extract-pdf-polygons.mjs` を実行してください。",
        );
        return;
      }
      if (!res.ok) throw new Error(`extractor fetch failed: ${res.status}`);
      const { manifest: extracted } = (await res.json()) as {
        manifest: ExtractedManifest;
      };
      setImportPanel({ extracted });
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, []);

  const handleApplyImport = useCallback(
    (selections: Record<string, { polygon: boolean; marker: boolean }>) => {
      if (!manifest || !importPanel) return;
      let count = 0;
      let next = manifest;
      const extById = new Map(
        importPanel.extracted.parts.map((p) => [p.id, p]),
      );
      for (const part of manifest.parts) {
        const sel = selections[part.id];
        if (!sel || (!sel.polygon && !sel.marker)) continue;
        const ex = extById.get(part.id);
        if (!ex) continue;
        const before: HistoryEntry = {
          editingId: part.id,
          editVariant: null,
          polygons: part.polygons.map((poly) => ({
            outer: poly.outer.map((v) => [v[0], v[1]] as Vertex),
            holes: poly.holes?.map((h) =>
              h.map((v) => [v[0], v[1]] as Vertex),
            ),
          })),
          marker: { ...part.marker },
        };
        historyRef.current.push(before);
        next = {
          ...next,
          parts: next.parts.map((p) =>
            p.id === part.id
              ? {
                  ...p,
                  polygons: sel.polygon
                    ? [{ outer: ex.polygon as Vertex[] }]
                    : p.polygons,
                  marker: sel.marker ? ex.marker : p.marker,
                }
              : p,
          ),
        };
        count++;
      }
      setManifest(next);
      latestManifestRef.current = next;
      if (scene) saveDraft(scene.id, next);
      scheduleAutosave();
      setHistoryRev((r) => r + 1);
      setImportPanel(null);
      setEditVariant(null);
      setError(`${count} 部材をインポートしました`);
    },
    [manifest, importPanel, scene, scheduleAutosave],
  );

  // ----- restore prompt actions -----

  const handleRestoreDraft = useCallback(() => {
    if (!restorePrompt || !scene) return;
    setManifest(restorePrompt.draftManifest);
    latestManifestRef.current = restorePrompt.draftManifest;
    historyRef.current.clear();
    setHistoryRev((r) => r + 1);
    setRestorePrompt(null);
    // Mark dirty: the draft is newer than disk; persist it now.
    scheduleAutosave();
  }, [restorePrompt, scene, scheduleAutosave]);

  const handleDiscardDraft = useCallback(() => {
    if (!restorePrompt || !scene) return;
    setManifest(restorePrompt.diskManifest);
    latestManifestRef.current = restorePrompt.diskManifest;
    historyRef.current.clear();
    setHistoryRev((r) => r + 1);
    clearDraft(scene.id);
    setRestorePrompt(null);
  }, [restorePrompt, scene]);

  // ----- manual download (fallback) -----

  const handleDownload = useCallback(() => {
    if (!manifest) return;
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parts.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [manifest]);

  // ----- render -----

  if (productionDisabled) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-sm text-slate-700">
        <h1 className="mb-3 text-base font-semibold text-slate-900">
          /dev/trace は本番環境では無効です
        </h1>
        <p>
          本番環境では <code>/dev/trace</code> は無効です。プレビューデプロイ
          または <code>npm run dev</code> をご利用ください。
        </p>
      </div>
    );
  }
  if (error && !manifest) {
    return (
      <div className="p-4 text-sm text-red-600">
        ロードに失敗しました: {error}
      </div>
    );
  }
  if (!scene || !manifest) {
    return <div className="p-4 text-sm text-slate-400">読み込み中…</div>;
  }

  const canUndo = historyRef.current.canUndo();
  const canRedo = historyRef.current.canRedo();
  // Reference historyRev so React re-renders when stack mutates without
  // changing other observable state. (The eslint rule that wants this in
  // deps is satisfied by reading it here.)
  void historyRev;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">/dev/trace</h1>
          <p className="text-[10px] text-slate-500">
            部材ポリゴン トレースツール（クリック=頂点追加 / 辺近くは中点挿入 / ドラッグ=移動 / 右クリック=削除 / ⌘Z 取消・⌘⇧Z やり直し）
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex w-[200px] flex-col items-end whitespace-nowrap leading-tight">
            <SaveBadge status={saveStatus} />
            <RegenBadge status={regenStatus} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            部材
            <select
              value={editingId ?? ""}
              onChange={(e) => handleSelectPart(e.target.value)}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
            >
              {manifest.parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {glyph(p.id)} {p.label}
                </option>
              ))}
            </select>
          </label>
          {scene.variants.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              マスク層
              <select
                value={editVariant ?? ""}
                onChange={(e) =>
                  handleSelectVariant(e.target.value || null)
                }
                title="編集対象のマスク層。基準＝当たり判定/番号マーカー用の共有ポリゴン。各バリアントは見た目のマスクのみ（切り替え画像ごと）。"
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
              >
                <option value="">基準（共有・当たり判定）</option>
                {scene.variants.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                    {editingPartRaw?.maskPolygonsByVariant?.[v.key]
                      ? " ●"
                      : " ○"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            表示
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
            >
              <option value="all">他部材も表示</option>
              <option value="current">編集中のみ</option>
              <option value="hidden">最小表示</option>
            </select>
          </label>
          <button
            type="button"
            onClick={handleRegenAll}
            title="全部材のマスク + shading を強制再生成（過去の編集で取りこぼした分も含めて再構築）"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
          >
            全マスク再生成
          </button>
          <button
            type="button"
            onClick={handleOpenImport}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
          >
            抽出結果を取込
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
          >
            ダウンロード
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[280px_1fr] overflow-hidden">
        <aside className="overflow-y-auto border-r border-slate-200 bg-slate-50 p-3 text-xs">
          {restorePrompt && (
            <div className="mb-3">
              <RestoreDraftPrompt
                diskMtime={restorePrompt.diskMtime}
                draftSavedAt={restorePrompt.draftSavedAt}
                onRestore={handleRestoreDraft}
                onDiscard={handleDiscardDraft}
              />
            </div>
          )}
          {error && manifest && (
            <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-[11px] text-red-800">
              <div className="flex items-start gap-2">
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="閉じる"
                  className="text-red-700 hover:text-red-900"
                >
                  ×
                </button>
              </div>
            </div>
          )}
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↶ 取消 (⌘Z)
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↷ やり直し (⌘⇧Z)
            </button>
          </div>
          {editingPart && (
            <div className="space-y-2">
              <div>
                <div className="text-base font-semibold">
                  {glyph(editingPart.id)} {editingPart.label}
                </div>
                <div className="text-[10px] text-slate-500">
                  #{editingPart.id} · {editingPart.category} · {editingPart.renderMode}
                </div>
              </div>
              {editVariant && (
                <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-[11px] text-indigo-900">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      マスク層: {scene.variants.find((v) => v.key === editVariant)?.label ?? editVariant}
                    </span>
                    {variantOverrideExists && (
                      <button
                        type="button"
                        onClick={handleRemoveVariantOverride}
                        className="text-[11px] text-red-600 hover:underline"
                      >
                        このバリアントを削除
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-indigo-700">
                    {variantOverrideExists
                      ? "このバリアント専用のマスクを編集中（当たり判定・マーカーは基準のまま）。"
                      : "基準ポリゴンを複製表示中。編集するとこのバリアント専用マスクが作成されます。"}
                  </p>
                </div>
              )}
              <RingGroups
                part={editingPart}
                activeRing={activeRing}
                onSelectRing={(target) => {
                  setActiveRing(target);
                  if (target.kind !== "hole") setHoleBuildMode(false);
                }}
                onDeleteVertex={(target, i) => handleDeleteVertex(target, i)}
                onRemovePolygon={handleRemoveActivePolygon}
                onRemoveHole={handleRemoveHole}
                canRemovePolygon={editingPart.polygons.length > 1}
              />
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={handleAddPolygon}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
                >
                  ＋ ポリゴンを追加
                </button>
                {!holeBuildMode ? (
                  <button
                    type="button"
                    onClick={handleAddHole}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
                  >
                    ＋ 穴を追加
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleEndHole}
                    className="rounded border border-rose-400 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:border-rose-500"
                  >
                    穴を完了 (Esc)
                  </button>
                )}
              </div>
              <div>
                <div className="font-semibold text-slate-700">マーカー</div>
                <div className="font-mono text-[11px] text-slate-500">
                  ({editingPart.marker.x}, {editingPart.marker.y})
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  キャンバス上のマーカー（白縁の円）をドラッグして位置を調整
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearActiveRing}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
              >
                編集中のリングをクリア
              </button>
            </div>
          )}
        </aside>

        <main className="flex items-start justify-center overflow-auto bg-slate-100 p-4">
          <Stage
            ref={stageRef}
            width={Math.round(scene.width * displayScale)}
            height={Math.round(scene.height * displayScale)}
            scaleX={displayScale}
            scaleY={displayScale}
            onClick={handleStageClick}
            onTap={handleStageClick}
            style={{
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
            }}
          >
            <Layer listening={false}>
              {baseImage && (
                <KonvaImage
                  image={baseImage}
                  x={0}
                  y={0}
                  width={scene.width}
                  height={scene.height}
                />
              )}
            </Layer>
            {visibility === "all" && (
              <Layer listening={false}>
                {manifest.parts
                  .filter((p) => p.id !== editingId)
                  .flatMap((p) =>
                    p.polygons.map((poly, pi) => (
                      <Line
                        key={`${p.id}-${pi}`}
                        points={poly.outer.flatMap(([x, y]) => [x, y])}
                        closed
                        stroke={CATEGORY_COLOR[p.category] ?? "#94A3B8"}
                        strokeWidth={3}
                        opacity={0.25}
                        dash={[12, 8]}
                      />
                    )),
                  )}
              </Layer>
            )}
            {editingPart && (
              <Layer>
                {/* One <Line> per ring. Outer rings get the part's category
                    color and a translucent fill (subdued for inactive
                    sub-polygons); hole rings get a contrasting accent
                    color and a shorter dash to distinguish them visually.
                    All lines stay non-listening so click events fall
                    through to the Stage's onClick handler. */}
                {editingPart.polygons.flatMap((poly, pi) => {
                  const lines: ReactNode[] = [];
                  const isActiveOuter =
                    activeRing.kind === "outer" &&
                    activeRing.polygonIndex === pi;
                  const outerStroke =
                    CATEGORY_COLOR[editingPart.category] ?? "#0F172A";
                  lines.push(
                    <Line
                      key={`p${pi}-outer`}
                      points={poly.outer.flatMap(([x, y]) => [x, y])}
                      closed
                      stroke={outerStroke}
                      strokeWidth={isActiveOuter ? 6 : 3}
                      opacity={isActiveOuter ? 1 : 0.45}
                      fill={
                        isActiveOuter
                          ? "rgba(59,130,246,0.10)"
                          : "rgba(59,130,246,0.04)"
                      }
                      listening={false}
                    />,
                  );
                  poly.holes?.forEach((hole, hi) => {
                    const isActiveHole =
                      activeRing.kind === "hole" &&
                      activeRing.polygonIndex === pi &&
                      activeRing.holeIndex === hi;
                    lines.push(
                      <Line
                        key={`p${pi}-hole-${hi}`}
                        points={hole.flatMap(([x, y]) => [x, y])}
                        closed
                        stroke="#DC2626"
                        strokeWidth={isActiveHole ? 5 : 3}
                        dash={[8, 6]}
                        opacity={isActiveHole ? 1 : 0.5}
                        listening={false}
                      />,
                    );
                  });
                  return lines;
                })}
                {/* Vertex handles for every ring of the editing part. The
                    handlers take an explicit `target` so the active ring
                    state isn't read inside the closure (which would stale-
                    close over the previous render's value during a burst). */}
                {editingPart.polygons.flatMap((poly, pi) => {
                  const handles: ReactNode[] = [];
                  const outerTarget: ActiveRing = {
                    kind: "outer",
                    polygonIndex: pi,
                  };
                  // Keep handles at a constant ~2 px screen radius
                  // regardless of the stage's displayScale so fine
                  // adjustment is comfortable on both small and large scenes.
                  const handleRadius = 2 / displayScale;
                  const holeRadius = 1.75 / displayScale;
                  const handleStroke = 0.75 / displayScale;
                  poly.outer.forEach((v, i) => {
                    handles.push(
                      <Circle
                        key={`p${pi}-outer-v${i}`}
                        x={v[0]}
                        y={v[1]}
                        radius={handleRadius}
                        fill="#ffffff"
                        stroke={
                          CATEGORY_COLOR[editingPart.category] ?? "#0F172A"
                        }
                        strokeWidth={handleStroke}
                        draggable
                        onMouseDown={() => setActiveRing(outerTarget)}
                        onDragStart={beginDrag}
                        onDragMove={(ev) =>
                          handleMoveVertexLive(
                            outerTarget,
                            i,
                            ev.target.x(),
                            ev.target.y(),
                          )
                        }
                        onDragEnd={endDrag}
                        onContextMenu={(ev) => {
                          ev.evt.preventDefault();
                          handleDeleteVertex(outerTarget, i);
                        }}
                      />,
                    );
                  });
                  poly.holes?.forEach((hole, hi) => {
                    const holeTarget: ActiveRing = {
                      kind: "hole",
                      polygonIndex: pi,
                      holeIndex: hi,
                    };
                    hole.forEach((v, i) => {
                      handles.push(
                        <Circle
                          key={`p${pi}-hole-${hi}-v${i}`}
                          x={v[0]}
                          y={v[1]}
                          radius={holeRadius}
                          fill="#FEE2E2"
                          stroke="#DC2626"
                          strokeWidth={handleStroke}
                          draggable
                          onMouseDown={() => setActiveRing(holeTarget)}
                          onDragStart={beginDrag}
                          onDragMove={(ev) =>
                            handleMoveVertexLive(
                              holeTarget,
                              i,
                              ev.target.x(),
                              ev.target.y(),
                            )
                          }
                          onDragEnd={endDrag}
                          onContextMenu={(ev) => {
                            ev.evt.preventDefault();
                            handleDeleteVertex(holeTarget, i);
                          }}
                        />,
                      );
                    });
                  });
                  return handles;
                })}
                {visibility !== "hidden" && (
                  <>
                    <Circle
                      x={editingPart.marker.x}
                      y={editingPart.marker.y}
                      radius={28}
                      fill={CATEGORY_COLOR[editingPart.category] ?? "#0F172A"}
                      stroke="#ffffff"
                      strokeWidth={4}
                      // Marker is shared across variants — only editable on the
                      // base layer. Dim + lock it while a variant is active.
                      opacity={editVariant ? 0.4 : 1}
                      draggable={!editVariant}
                      onDragStart={beginDrag}
                      onDragMove={(ev) =>
                        handleMoveMarkerLive(ev.target.x(), ev.target.y())
                      }
                      onDragEnd={endDrag}
                    />
                    <Text
                      text={glyph(editingPart.id)}
                      x={editingPart.marker.x - 28}
                      y={editingPart.marker.y - 22}
                      width={56}
                      height={44}
                      fontSize={36}
                      fontStyle="bold"
                      fill="#ffffff"
                      align="center"
                      verticalAlign="middle"
                      listening={false}
                    />
                  </>
                )}
              </Layer>
            )}
          </Stage>
        </main>
      </div>

      {importPanel && manifest && (
        <ExtractorImportPanel
          current={manifest}
          extracted={importPanel.extracted}
          onClose={() => setImportPanel(null)}
          onApply={handleApplyImport}
        />
      )}
    </div>
  );
}

function RegenBadge({ status }: { status: RegenStatus }) {
  // All variants are constrained to a single line via the parent's
  // `whitespace-nowrap` so the header height never shifts and the canvas
  // beneath stays put.
  switch (status.kind) {
    case "idle":
      return null;
    case "scheduled":
      return (
        <span className="text-[10px] text-slate-400">マスク再生成 待機中…</span>
      );
    case "running":
      return (
        <span className="text-[10px] text-slate-500">マスク再生成 中…</span>
      );
    case "done":
      return (
        <span
          className="text-[10px] text-emerald-700"
          title="メイン画面 (/) はリロードで反映されます"
        >
          マスク更新 {status.count}件 {formatTime(status.at)}
        </span>
      );
    case "failed":
      return (
        <span className="text-[10px] text-red-700" title={status.message}>
          マスク再生成 失敗
        </span>
      );
    case "preview-readonly":
      return (
        <span
          className="text-[10px] text-amber-700"
          title="プレビュー環境では再生成不可。ローカルで再生成 → コミット → 再デプロイで反映されます。"
        >
          マスク再生成 不可（プレビュー）
        </span>
      );
  }
}

function SaveBadge({ status }: { status: SaveStatus }) {
  switch (status.kind) {
    case "idle":
      return (
        <span className="text-[11px] text-slate-400">未編集</span>
      );
    case "saving":
      return (
        <span className="text-[11px] text-slate-500">保存中…</span>
      );
    case "saved":
      return (
        <span className="text-[11px] text-emerald-700">
          保存済み {formatTime(status.at)}
        </span>
      );
    case "validation-failed":
      return (
        <span className="text-[11px] text-red-700" title={status.message}>
          バリデーション失敗（ローカル保持）
        </span>
      );
    case "local-only":
      return (
        <span className="text-[11px] text-amber-700">
          ローカルに保持中（再送信を試行...）
        </span>
      );
    case "preview-readonly":
      return (
        <span
          className="text-[11px] text-amber-700"
          title="プレビューはディスク保存不可。ヘッダの「ダウンロード」から parts.json を取得してブランチへコミットしてください。"
        >
          プレビューは保存不可 — ダウンロードしてコミット
        </span>
      );
  }
}

// Side-panel grouping: one foldable section per polygon entry; outer first,
// then each hole. Clicking a heading focuses that ring; the active ring is
// highlighted with a colored border. Vertex rows show their (poly, ring kind,
// vertex index) and offer a delete affordance.
function RingGroups({
  part,
  activeRing,
  onSelectRing,
  onDeleteVertex,
  onRemovePolygon,
  onRemoveHole,
  canRemovePolygon,
}: {
  part: Part;
  activeRing: ActiveRing;
  onSelectRing: (target: ActiveRing) => void;
  onDeleteVertex: (target: ActiveRing, vertexIndex: number) => void;
  onRemovePolygon: () => void;
  onRemoveHole: (polygonIndex: number, holeIndex: number) => void;
  canRemovePolygon: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-700">
          ポリゴン ({part.polygons.length})
        </div>
        {canRemovePolygon && activeRing.kind === "outer" && (
          <button
            type="button"
            onClick={onRemovePolygon}
            className="text-[11px] text-red-600 hover:underline"
          >
            この sub-polygon を削除
          </button>
        )}
      </div>
      {part.polygons.map((poly, pi) => {
        const outerActive =
          activeRing.kind === "outer" && activeRing.polygonIndex === pi;
        return (
          <div
            key={pi}
            className="overflow-hidden rounded border border-slate-200 bg-white"
          >
            <button
              type="button"
              onClick={() =>
                onSelectRing({ kind: "outer", polygonIndex: pi })
              }
              className={`flex w-full items-center justify-between px-2 py-1 text-left text-[11px] ${
                outerActive
                  ? "bg-blue-50 font-semibold text-blue-900"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span>
                ポリゴン {pi + 1} / outer ({poly.outer.length} 頂点)
              </span>
              {outerActive && (
                <span className="text-[9px] uppercase tracking-wide text-blue-700">
                  編集中
                </span>
              )}
            </button>
            {outerActive && (
              <ul className="max-h-48 overflow-y-auto border-t border-slate-200">
                {poly.outer.map((v, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0"
                  >
                    <span className="font-mono text-[11px]">
                      {i}: {v[0]}, {v[1]}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onDeleteVertex(
                          { kind: "outer", polygonIndex: pi },
                          i,
                        )
                      }
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {poly.holes?.map((hole, hi) => {
              const holeActive =
                activeRing.kind === "hole" &&
                activeRing.polygonIndex === pi &&
                activeRing.holeIndex === hi;
              return (
                <div
                  key={`hole-${hi}`}
                  className="border-t border-slate-200"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onSelectRing({
                        kind: "hole",
                        polygonIndex: pi,
                        holeIndex: hi,
                      })
                    }
                    className={`flex w-full items-center justify-between px-2 py-1 pl-4 text-left text-[11px] ${
                      holeActive
                        ? "bg-rose-50 font-semibold text-rose-900"
                        : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>
                      └ hole {hi + 1} ({hole.length} 頂点)
                    </span>
                    <span className="flex items-center gap-2">
                      {holeActive && (
                        <span className="text-[9px] uppercase tracking-wide text-rose-700">
                          編集中
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveHole(pi, hi);
                        }}
                        className="text-[11px] text-red-600 hover:underline"
                      >
                        削除
                      </button>
                    </span>
                  </button>
                  {holeActive && (
                    <ul className="max-h-40 overflow-y-auto border-t border-slate-200">
                      {hole.map((v, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1 pl-4 last:border-b-0"
                        >
                          <span className="font-mono text-[11px]">
                            {i}: {v[0]}, {v[1]}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onDeleteVertex(
                                {
                                  kind: "hole",
                                  polygonIndex: pi,
                                  holeIndex: hi,
                                },
                                i,
                              )
                            }
                            className="text-[11px] text-red-600 hover:underline"
                          >
                            削除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
