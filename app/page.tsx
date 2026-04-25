"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { ScenePicker } from "@/components/scenes/ScenePicker";
import { CatalogPanel } from "@/components/catalog/CatalogPanel";
import { PartColorPicker } from "@/components/color/PartColorPicker";
import { Toast } from "@/components/Toast";
import { useCanvasStore } from "@/lib/canvas/store";
import { loadCatalog } from "@/lib/catalog/load";
import type { MaterialCatalog } from "@/lib/catalog/schema";

// Konva must never run on the server. This is the single ssr:false boundary.
const CanvasStage = dynamic(
  () => import("@/components/canvas/CanvasStage.client"),
  { ssr: false },
);

export default function Page() {
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<MaterialCatalog | null>(null);
  const activeScene = useCanvasStore((s) => s.activeScene);
  const requestExport = useCanvasStore((s) => s.requestExport);

  // Catalog is loaded once at the page level so the canvas (which needs entry lookups
  // for material placement) and the catalog panel share the same instance.
  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch((err: unknown) => {
        if (alive) setError((err as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleError = useCallback((msg: string) => setError(msg), []);

  return (
    <div className="flex h-screen flex-col">
      <Toast message={error} onDismiss={() => setError(null)} />
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold text-slate-900">
            SpecDrawing
          </h1>
          <p className="text-[10px] text-slate-500">Material Presenter — MVP</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => requestExport()}
            disabled={!activeScene}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Export PNG
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[220px_1fr_280px] overflow-hidden">
        <aside className="overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
          <ScenePicker onError={handleError} />
        </aside>

        <main className="flex items-center justify-center overflow-auto bg-slate-100 p-4">
          <CanvasStage catalog={catalog} />
        </main>

        <aside className="flex flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3">
          <CatalogPanel onError={handleError} />
          <PartColorPicker />
        </aside>
      </div>
    </div>
  );
}
