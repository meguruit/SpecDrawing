"use client";

import { useCallback, useEffect, useRef } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";

import { useCanvasStore } from "@/lib/canvas/store";
import { useImage } from "@/lib/canvas/useImageCache";
import type { MaterialCatalog } from "@/lib/catalog/schema";
import { ColorCompositeLayer } from "./ColorCompositeLayer";
import { MaterialsLayer } from "./MaterialsLayer";

type Props = {
  catalog: MaterialCatalog | null;
};

function formatTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export default function CanvasStage({ catalog }: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const scene = useCanvasStore((s) => s.activeScene);
  const baseImage = useImage(scene?.baseImageUrl);
  const selectionId = useCanvasStore((s) => s.selectionId);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const select = useCanvasStore((s) => s.select);
  const deleteMaterial = useCanvasStore((s) => s.deleteMaterial);
  const exportRequestedAt = useCanvasStore((s) => s.exportRequestedAt);

  // Delete / Backspace removes the selected material (only when nothing else has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const id = useCanvasStore.getState().selectionId;
      if (id) {
        e.preventDefault();
        deleteMaterial(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteMaterial]);

  // Export pipeline: when requestExport is dispatched, snapshot the stage at pixelRatio 2,
  // exclude selection chrome by clearing the selection just for the duration of the snapshot.
  useEffect(() => {
    if (!exportRequestedAt) return;
    const stage = stageRef.current;
    const sceneNow = useCanvasStore.getState().activeScene;
    if (!stage || !sceneNow) return;

    const previousSelection = useCanvasStore.getState().selectionId;
    if (previousSelection) {
      // Clear selection so handles/border don't render in the exported PNG.
      useCanvasStore.getState().clearSelection();
    }

    // Defer to next frame so the cleared-selection re-render lands before toDataURL.
    const handle = requestAnimationFrame(() => {
      try {
        const dataUrl = stage.toDataURL({
          pixelRatio: 2,
          mimeType: "image/png",
        });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `specdrawing-${sceneNow.id}-${formatTimestamp()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        if (previousSelection) {
          useCanvasStore.getState().select(previousSelection);
        }
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [exportRequestedAt]);

  const handleStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Click on the stage background (not on a child shape) clears the selection.
      if (e.target === e.target.getStage()) {
        clearSelection();
      }
    },
    [clearSelection],
  );

  if (!scene) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        左のシーンピッカーからベースシーンを選択してください
      </div>
    );
  }

  return (
    <Stage
      ref={stageRef}
      width={scene.width}
      height={scene.height}
      onMouseDown={handleStageMouseDown}
      onTouchStart={handleStageMouseDown}
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
      <ColorCompositeLayer />
      <MaterialsLayer catalog={catalog} />
    </Stage>
  );
}
