"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect } from "react";

import { Toast } from "@/components/Toast";
import { PartList } from "@/components/parts/PartList";
import { FinishOptionPanel } from "@/components/finishes/FinishOptionPanel";
import { SheetSwitcher } from "@/components/finishes/SheetSwitcher";
import { MarkerToggle } from "@/components/finishes/MarkerToggle";
import { useCanvasStore } from "@/lib/canvas/store";
import {
  loadScenesIndex,
  loadScene,
  pickDefaultScene,
  SceneLoadError,
} from "@/lib/scenes/load";
import { loadPartsForScene, PartsLoadError } from "@/lib/parts/load";
import {
  loadFinishOptions,
  crossValidateAgainstParts,
  availableSheets,
  FinishesLoadError,
} from "@/lib/finishes/load";

// Konva must never run on the server. Single ssr:false boundary.
const CanvasStage = dynamic(
  () => import("@/components/canvas/CanvasStage.client"),
  { ssr: false },
);

export default function Page() {
  const activeScene = useCanvasStore((s) => s.activeScene);
  const requestExport = useCanvasStore((s) => s.requestExport);
  const notification = useCanvasStore((s) => s.notification);
  const dismissNotification = useCanvasStore((s) => s.dismissNotification);
  const loadSceneAction = useCanvasStore((s) => s.loadScene);

  // Auto-load default registered perspective on app start.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const index = await loadScenesIndex();
        const def = pickDefaultScene(index);
        const scene = await loadScene(def.manifestUrl);
        const parts = await loadPartsForScene(scene);
        const options = await loadFinishOptions();
        crossValidateAgainstParts(options, parts);
        if (!alive) return;
        const sheets = availableSheets(options);
        loadSceneAction(scene, parts, options, sheets[0] ?? "");
      } catch (err: unknown) {
        if (!alive) return;
        const msg =
          err instanceof SceneLoadError ||
          err instanceof PartsLoadError ||
          err instanceof FinishesLoadError
            ? err.message
            : `初期化に失敗しました: ${(err as Error).message}`;
        useCanvasStore.setState({
          notification: { id: Date.now(), message: msg },
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadSceneAction]);

  const onExport = useCallback(() => requestExport(), [requestExport]);

  return (
    <div className="flex h-screen flex-col">
      <Toast
        message={notification?.message ?? null}
        onDismiss={dismissNotification}
      />
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold text-slate-900">SpecDrawing</h1>
          <p className="text-[10px] text-slate-500">
            部材対応番号 × 部材リスト プレゼンター
          </p>
        </div>
        <div className="flex items-center gap-4">
          <SheetSwitcher />
          <MarkerToggle />
          <button
            type="button"
            onClick={onExport}
            disabled={!activeScene}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Export PNG
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr_300px] overflow-hidden">
        <aside className="overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
          <PartList />
        </aside>

        <main className="flex items-center justify-center overflow-auto bg-slate-100 p-4">
          <CanvasStage />
        </main>

        <aside className="flex flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3">
          <FinishOptionPanel />
        </aside>
      </div>
    </div>
  );
}
