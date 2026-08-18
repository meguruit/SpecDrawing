"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Toast } from "@/components/Toast";
import { ExtrasBriefPanel } from "@/components/exterior/ExtrasBriefPanel";
import { ImageUploader } from "@/components/exterior/ImageUploader";
import { JolypateColorPanel } from "@/components/exterior/JolypateColorPanel";
import { ProjectBar } from "@/components/exterior/ProjectBar";
import { ZoneList } from "@/components/exterior/ZoneList";
import { ZoneSettings } from "@/components/exterior/ZoneSettings";
import {
  useExteriorStore,
  selectActiveAngle,
  selectActiveProject,
} from "@/lib/exterior/store";
import { loadJolypateColors } from "@/lib/jolypate/load";
import type { JolypateColor } from "@/lib/jolypate/schema";
import { formatExportTimestamp } from "@/lib/export/filename";

// Konva must never run on the server. Single ssr:false boundary, mirroring
// the interior presenter.
const ExteriorCanvas = dynamic(
  () => import("@/components/exterior/ExteriorCanvas.client"),
  { ssr: false },
);

export default function ExteriorWorkspace() {
  const [colors, setColors] = useState<JolypateColor[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const project = useExteriorStore(selectActiveProject);
  const angle = useExteriorStore(selectActiveAngle);
  const loading = useExteriorStore((s) => s.loading);
  const notification = useExteriorStore((s) => s.notification);
  const dismiss = useExteriorStore((s) => s.dismissNotification);
  const notify = useExteriorStore((s) => s.notify);
  const init = useExteriorStore((s) => s.init);
  const undo = useExteriorStore((s) => s.undo);
  const redo = useExteriorStore((s) => s.redo);
  const selectZone = useExteriorStore((s) => s.selectZone);
  const historyRev = useExteriorStore((s) => s.historyRev);
  const canUndo = useExteriorStore((s) => s.canUndo);
  const canRedo = useExteriorStore((s) => s.canRedo);
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    void init();
  }, [init]);

  useEffect(() => {
    loadJolypateColors()
      .then((cat) => setColors(cat.colors))
      .catch((err) => notify(err.message));
  }, [notify]);

  // Undo / redo, matching /dev/trace's bindings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never steal the shortcut from a text field.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const onExport = useCallback(async () => {
    if (!project || !colors || project.angles.length === 0) return;
    setExporting(true);
    const ts = formatExportTimestamp();
    try {
      const [
        { buildExteriorExportFilename, buildExteriorSpecSheetBlob, captureAnglePng, deliverExteriorExport },
        store,
      ] = [await import("@/lib/exterior/export"), useExteriorStore.getState()];

      const files: Array<{ blob: Blob; filename: string }> = [];
      const originalAngleId = store.activeAngleId;

      // Angles are rendered one at a time through the live stage: a 4000 px
      // perspective per angle decoded concurrently would spike memory for no
      // benefit.
      for (const a of project.angles) {
        if (useExteriorStore.getState().activeAngleId !== a.id) {
          await useExteriorStore.getState().selectAngle(a.id);
          // Let the swapped base image and zone caches land before capture.
          await new Promise((r) => setTimeout(r, 250));
        }
        const scale = Math.min(1, 1100 / a.width, 760 / a.height);
        const blob = await captureAnglePng(1 / scale);
        files.push({
          blob,
          filename: buildExteriorExportFilename(project.name, a.label, ts, "png"),
        });
      }

      if (originalAngleId && useExteriorStore.getState().activeAngleId !== originalAngleId) {
        await useExteriorStore.getState().selectAngle(originalAngleId);
      }

      files.push({
        blob: await buildExteriorSpecSheetBlob(project, colors),
        filename: buildExteriorExportFilename(project.name, null, ts, "xlsx"),
      });

      await deliverExteriorExport(files);
      if (files.length > 1) {
        notify(
          `${files.length} 件を書き出しました。一部しか保存されない場合はブラウザの「複数ファイルの自動ダウンロード」を許可してください。`,
        );
      }
    } catch (err) {
      notify(`エクスポートに失敗しました: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [project, colors, notify]);

  const onExportJson = useCallback(async () => {
    if (!project) return;
    const [{ serializeProject, projectJsonFilename }, { downloadBlob }] = await Promise.all([
      import("@/lib/exterior/export"),
      import("@/lib/export/download"),
    ]);
    downloadBlob(
      new Blob([serializeProject(project)], { type: "application/json" }),
      projectJsonFilename(project.name),
    );
  }, [project]);

  const canExport = !!project && project.angles.length > 0 && !!colors && !exporting;

  return (
    <div className="flex h-screen flex-col">
      <Toast message={notification?.message ?? null} onDismiss={dismiss} />

      <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-start gap-4">
          <div>
            <Link href="/" className="text-sm font-semibold text-slate-900 hover:underline">
              SpecDrawing
            </Link>
            <p className="text-[10px] text-slate-500">外観パース塗り分け</p>
          </div>
          <ProjectBar />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo()}
            title="元に戻す (Cmd/Ctrl+Z)"
            data-history-rev={historyRev}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-40"
          >
            元に戻す
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo()}
            title="やり直す (Cmd/Ctrl+Shift+Z)"
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-40"
          >
            やり直す
          </button>
          <button
            type="button"
            onClick={() => void onExportJson()}
            disabled={!project}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-40"
          >
            案件 JSON
          </button>
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={!canExport}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {exporting ? "書き出し中…" : "外観仕様エクスポート"}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : !project ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h2 className="text-sm font-semibold text-slate-900">案件を作成してください</h2>
            <p className="mt-1 text-xs text-slate-500">
              ヘッダーの「＋案件」から案件を作成し、ホワイトパースをアップロードします。
            </p>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[260px_1fr_300px] overflow-hidden">
          <aside className="flex flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
            <ImageUploader compact={project.angles.length > 0} />
            {angle && (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-xs font-semibold text-slate-900">
                    ゾーン
                    <span className="ml-1 font-normal text-slate-400">
                      {angle.zones.length}
                    </span>
                  </h2>
                  {/* Clicking the canvas always extends the selected zone, so
                      starting another one needs an explicit "nothing is
                      selected" step. */}
                  <button
                    type="button"
                    onClick={() => selectZone(null)}
                    className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:border-slate-500"
                  >
                    ＋新規ゾーン
                  </button>
                </div>
                <ZoneList colors={colors ?? []} />
              </>
            )}
            <ExtrasBriefPanel />
          </aside>

          <main className="flex items-center justify-center overflow-auto bg-slate-100 p-4">
            {colors ? (
              <ExteriorCanvas colors={colors} />
            ) : (
              <p className="text-sm text-slate-400">カラーカタログを読み込み中…</p>
            )}
          </main>

          <aside className="flex min-h-0 flex-col gap-3 overflow-hidden border-l border-slate-200 bg-slate-50 p-3">
            <ZoneSettings />
            {colors && <JolypateColorPanel colors={colors} />}
          </aside>
        </div>
      )}
    </div>
  );
}
