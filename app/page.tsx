"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef } from "react";

import { Toast } from "@/components/Toast";
import { PartList } from "@/components/parts/PartList";
import { FinishOptionPanel } from "@/components/finishes/FinishOptionPanel";
import { SheetSwitcher } from "@/components/finishes/SheetSwitcher";
import { VariantSwitcher } from "@/components/finishes/VariantSwitcher";
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
  loadSheetsManifest,
  crossValidateAgainstParts,
  crossValidateColorHexByVariantAgainstScene,
  crossValidateDefaultsAgainstScene,
  crossValidateOptionsAgainstSheets,
  crossValidatePartsAgainstSheets,
  crossValidateSheetsAgainstScene,
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
  const exportRequestedAt = useCanvasStore((s) => s.exportRequestedAt);
  const notification = useCanvasStore((s) => s.notification);
  const dismissNotification = useCanvasStore((s) => s.dismissNotification);
  const loadSceneAction = useCanvasStore((s) => s.loadScene);
  const lastExcelExportAt = useRef(0);

  // Auto-load default registered perspective on app start.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const index = await loadScenesIndex();
        const def = pickDefaultScene(index);
        const scene = await loadScene(def.manifestUrl);
        const parts = await loadPartsForScene(scene);
        const { options, _rev: optionsRev } = await loadFinishOptions();
        const sheetsManifest = await loadSheetsManifest();
        crossValidateAgainstParts(options, parts);
        crossValidateSheetsAgainstScene(sheetsManifest, scene);
        crossValidateDefaultsAgainstScene(options, scene);
        crossValidateColorHexByVariantAgainstScene(options, scene);
        // The variant-policy validators are warn-mode while the customer's
        // updated 部材リスト.xlsx (with texture options for parts 15/17 and
        // textureUrlByVariant on every アーバンシー option) is in flight.
        // Flip both to "strict" once the seed pipeline emits the full shape.
        crossValidatePartsAgainstSheets(parts, sheetsManifest, scene, "warn");
        crossValidateOptionsAgainstSheets(
          options,
          parts,
          sheetsManifest,
          scene,
          "warn",
        );
        if (!alive) return;
        const sheets = availableSheets(options);
        loadSceneAction(
          scene,
          parts,
          options,
          sheets[0] ?? "",
          optionsRev,
          sheetsManifest,
        );
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

  // Excel spec-sheet export: triggered by the same `requestExport` action
  // as the PNG. Dynamic-imported so `exceljs` lands only on first click.
  useEffect(() => {
    if (!exportRequestedAt) return;
    if (lastExcelExportAt.current === exportRequestedAt) return;
    lastExcelExportAt.current = exportRequestedAt;
    const state = useCanvasStore.getState();
    if (!state.activeScene) return;
    (async () => {
      const [{ downloadSpecSheet }, { buildExportFilename }] = await Promise.all([
        import("@/lib/export/spec-sheet"),
        import("@/lib/export/filename"),
      ]);
      const ts = state.exportTimestamp ?? "";
      const filename = buildExportFilename(
        state.activeScene!.id,
        state.activeVariantKey,
        ts,
        "xlsx",
      );
      try {
        await downloadSpecSheet({
          parts: state.parts,
          finishOptions: state.finishOptions,
          selections: state.partFinishSelections,
          activeSheet: state.activeOptionSheet,
          activeVariantKey: state.activeVariantKey,
          filename,
          optionsRev: state.finishOptionsRev,
        });
      } catch (err) {
        useCanvasStore.setState({
          notification: {
            id: Date.now(),
            message: `Excel エクスポートに失敗しました: ${(err as Error).message}`,
          },
        });
      }
    })();
  }, [exportRequestedAt]);

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
          <VariantSwitcher />
          <MarkerToggle />
          <button
            type="button"
            onClick={onExport}
            disabled={!activeScene}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            選択部材エクスポート
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
