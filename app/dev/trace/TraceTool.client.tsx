"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import type { Part, PartsManifest } from "@/lib/parts/types";
import {
  loadDraft,
  saveDraft,
  clearDraft,
} from "@/lib/dev/draftStore";
import { History, type HistoryEntry } from "@/lib/dev/history";
import { nearestEdge, type Point } from "@/lib/dev/geometry";
import { RestoreDraftPrompt } from "@/components/dev/RestoreDraftPrompt";
import { ExtractorImportPanel } from "@/components/dev/ExtractorImportPanel";

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
  | { kind: "local-only"; since: number };

type RegenStatus =
  | { kind: "idle" }
  | { kind: "scheduled" }
  | { kind: "running" }
  | { kind: "done"; count: number; at: string }
  | { kind: "failed"; message: string };

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
  const [error, setError] = useState<string | null>(null);
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
    extracted: PartsManifest;
  } | null>(null);
  const [historyRev, setHistoryRev] = useState(0); // bump to re-render undo/redo buttons

  const stageRef = useRef<Konva.Stage>(null);
  const historyRef = useRef(new History());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryStartedAtRef = useRef<number | null>(null);
  // Latest manifest snapshot for autosave callbacks (avoids stale closures).
  const latestManifestRef = useRef<PartsManifest | null>(null);

  const baseImage = useImage(scene?.baseImageUrl);

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

  const editingPart: Part | undefined = useMemo(
    () => manifest?.parts.find((p) => p.id === editingId),
    [manifest, editingId],
  );

  const displayScale = useMemo(
    () => (scene ? Math.min(1, MAX_DISPLAY_WIDTH / scene.width) : 1),
    [scene],
  );

  // Snapshot the editing part's current state (for history pushes).
  const snapshotCurrent = useCallback((): HistoryEntry | null => {
    if (!editingPart) return null;
    return {
      editingId: editingPart.id,
      polygon: editingPart.polygon.map((v) => [v[0], v[1]] as [number, number]),
      marker: { ...editingPart.marker },
    };
  }, [editingPart]);

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
        parts: manifest.parts.map((p) => (p.id === id ? mutator(p) : p)),
      };
      commit(next, { pushBefore });
    },
    [manifest, commit],
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
    (x: number, y: number) => {
      if (!editingPart) return;
      const before = snapshotCurrent();
      updatePart(
        editingPart.id,
        (p) => ({
          ...p,
          polygon: [...p.polygon, [Math.round(x), Math.round(y)]],
        }),
        before,
      );
    },
    [editingPart, snapshotCurrent, updatePart],
  );

  const handleInsertVertexAt = useCallback(
    (edgeIndex: number, foot: Point) => {
      if (!editingPart) return;
      const before = snapshotCurrent();
      updatePart(
        editingPart.id,
        (p) => {
          const next = p.polygon.slice() as Array<[number, number]>;
          next.splice(edgeIndex + 1, 0, [
            Math.round(foot[0]),
            Math.round(foot[1]),
          ]);
          return { ...p, polygon: next };
        },
        before,
      );
    },
    [editingPart, snapshotCurrent, updatePart],
  );

  const handleMoveVertexLive = useCallback(
    (idx: number, x: number, y: number) => {
      if (!editingPart) return;
      // Live drag — no history push, just state update + draft mirror.
      updatePart(
        editingPart.id,
        (p) => {
          const next = p.polygon.slice() as Array<[number, number]>;
          next[idx] = [Math.round(x), Math.round(y)];
          return { ...p, polygon: next };
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
    (idx: number) => {
      if (!editingPart) return;
      const before = snapshotCurrent();
      updatePart(
        editingPart.id,
        (p) => ({
          ...p,
          polygon: p.polygon.filter((_, i) => i !== idx),
        }),
        before,
      );
    },
    [editingPart, snapshotCurrent, updatePart],
  );

  const handleMoveMarkerLive = useCallback(
    (x: number, y: number) => {
      if (!editingPart) return;
      updatePart(
        editingPart.id,
        (p) => ({
          ...p,
          marker: { x: Math.round(x), y: Math.round(y) },
        }),
        null,
      );
    },
    [editingPart, updatePart],
  );

  const handleClearPolygon = useCallback(() => {
    if (!editingPart) return;
    const before = snapshotCurrent();
    updatePart(editingPart.id, (p) => ({ ...p, polygon: [] }), before);
  }, [editingPart, snapshotCurrent, updatePart]);

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (e.target !== e.target.getStage()) return;
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos || !editingPart) return;
      const sx = pos.x / displayScale;
      const sy = pos.y / displayScale;
      const hit = nearestEdge(
        editingPart.polygon as ReadonlyArray<Point>,
        [sx, sy],
        EDGE_INSERT_TOLERANCE_PX / displayScale,
      );
      if (hit) {
        handleInsertVertexAt(hit.edgeIndex, hit.foot);
      } else {
        handleAddVertex(sx, sy);
      }
    },
    [editingPart, displayScale, handleInsertVertexAt, handleAddVertex],
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

  // ----- undo / redo -----

  const applyHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      if (!manifest) return;
      // If the entry's editingId differs, switch parts first (no further push).
      if (entry.editingId !== editingId) {
        setEditingId(entry.editingId);
      }
      if (!entry.editingId) {
        // No-op; nothing to apply.
        return;
      }
      const id = entry.editingId;
      const next: PartsManifest = {
        ...manifest,
        parts: manifest.parts.map((p) =>
          p.id === id
            ? {
                ...p,
                polygon: entry.polygon.map(
                  (v) => [v[0], v[1]] as [number, number],
                ),
                marker: { ...entry.marker },
              }
            : p,
        ),
      };
      commit(next);
    },
    [manifest, editingId, commit],
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
  }, [undo, redo]);

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
        manifest: PartsManifest;
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
          polygon: part.polygon.map((v) => [v[0], v[1]] as [number, number]),
          marker: { ...part.marker },
        };
        historyRef.current.push(before);
        next = {
          ...next,
          parts: next.parts.map((p) =>
            p.id === part.id
              ? {
                  ...p,
                  polygon: sel.polygon ? ex.polygon : p.polygon,
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
              <div>
                <div className="font-semibold text-slate-700">頂点</div>
                <div className="text-[10px] text-slate-500">
                  {editingPart.polygon.length} 頂点
                </div>
                <ul className="mt-1 max-h-64 overflow-y-auto rounded border border-slate-200 bg-white">
                  {editingPart.polygon.map((v, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0"
                    >
                      <span className="font-mono text-[11px]">
                        {i}: {v[0]}, {v[1]}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteVertex(i)}
                        className="text-[11px] text-red-600 hover:underline"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
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
                onClick={handleClearPolygon}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
              >
                ポリゴンをクリア
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
                  .map((p) => (
                    <Line
                      key={p.id}
                      points={p.polygon.flatMap(([x, y]) => [x, y])}
                      closed
                      stroke={CATEGORY_COLOR[p.category] ?? "#94A3B8"}
                      strokeWidth={3}
                      opacity={0.25}
                      dash={[12, 8]}
                    />
                  ))}
              </Layer>
            )}
            {editingPart && (
              <Layer>
                <Line
                  points={editingPart.polygon.flatMap(([x, y]) => [x, y])}
                  closed
                  stroke={CATEGORY_COLOR[editingPart.category] ?? "#0F172A"}
                  strokeWidth={6}
                  fill="rgba(59,130,246,0.10)"
                  // Visual outline only. Without listening=false the
                  // semi-transparent fill swallows clicks inside the
                  // polygon, breaking click-to-add-vertex and even
                  // right-click-on-vertex (when the vertex circle is
                  // small relative to the polygon area).
                  listening={false}
                />
                {editingPart.polygon.map((v, i) => (
                  <Circle
                    key={i}
                    x={v[0]}
                    y={v[1]}
                    radius={14}
                    fill="#ffffff"
                    stroke={
                      CATEGORY_COLOR[editingPart.category] ?? "#0F172A"
                    }
                    strokeWidth={3}
                    draggable
                    onDragStart={beginDrag}
                    onDragMove={(ev) =>
                      handleMoveVertexLive(i, ev.target.x(), ev.target.y())
                    }
                    onDragEnd={endDrag}
                    onContextMenu={(ev) => {
                      ev.evt.preventDefault();
                      handleDeleteVertex(i);
                    }}
                  />
                ))}
                {visibility !== "hidden" && (
                  <>
                    <Circle
                      x={editingPart.marker.x}
                      y={editingPart.marker.y}
                      radius={28}
                      fill={CATEGORY_COLOR[editingPart.category] ?? "#0F172A"}
                      stroke="#ffffff"
                      strokeWidth={4}
                      draggable
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
  }
}
