"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";

import { useCanvasStore } from "@/lib/canvas/store";
import { useImage } from "@/lib/canvas/useImageCache";
import { PartFinishLayer } from "@/components/parts/PartFinishLayer";
import {
  PartMarkerLayer,
  isPointInsideAnyPart,
} from "@/components/parts/PartMarkerLayer";
import {
  buildExportFilename,
  formatExportTimestamp,
} from "@/lib/export/filename";

const MAX_DISPLAY_WIDTH = 1100;

export default function CanvasStage() {
  const stageRef = useRef<Konva.Stage>(null);
  const scene = useCanvasStore((s) => s.activeScene);
  const parts = useCanvasStore((s) => s.parts);
  const activeVariantKey = useCanvasStore((s) => s.activeVariantKey);
  // Resolve which base image to display: when a variant is active, swap to
  // its `baseImageUrl`. Otherwise fall back to the scene's default base.
  const baseUrl = useMemo(() => {
    if (!scene) return undefined;
    if (activeVariantKey) {
      const v = scene.variants.find((entry) => entry.key === activeVariantKey);
      if (v) return v.baseImageUrl;
    }
    return scene.baseImageUrl;
  }, [scene, activeVariantKey]);
  const baseImage = useImage(baseUrl);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const selectPart = useCanvasStore((s) => s.selectPart);
  const exportRequestedAt = useCanvasStore((s) => s.exportRequestedAt);
  const [hover, setHover] = useState<{ partId: string } | null>(null);

  // Display scale: keep wider scenes visible without horizontal scroll.
  const displayScale = useMemo(() => {
    if (!scene) return 1;
    return Math.min(1, MAX_DISPLAY_WIDTH / scene.width);
  }, [scene]);

  useEffect(() => {
    if (!exportRequestedAt) return;
    const stage = stageRef.current;
    const sceneNow = useCanvasStore.getState().activeScene;
    if (!stage || !sceneNow) return;

    const previousMarkersVisible =
      useCanvasStore.getState().markersVisible;
    if (previousMarkersVisible) {
      // Hide markers in export by toggling off for the snapshot.
      useCanvasStore.setState({ markersVisible: false });
    }

    const handle = requestAnimationFrame(() => {
      try {
        // pixelRatio compensates for the on-screen displayScale so the export
        // is at native scene resolution.
        const dataUrl = stage.toDataURL({
          pixelRatio: 1 / displayScale,
          mimeType: "image/png",
        });
        const ts =
          useCanvasStore.getState().exportTimestamp ?? formatExportTimestamp();
        const variantKey = useCanvasStore.getState().activeVariantKey;
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = buildExportFilename(sceneNow.id, variantKey, ts, "png");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        if (previousMarkersVisible) {
          useCanvasStore.setState({ markersVisible: true });
        }
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [exportRequestedAt, displayScale]);

  const handleStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      // If the click landed on the empty stage (no shape), test whether it falls
      // inside any part polygon. If so, select that part; otherwise deselect.
      if (e.target === e.target.getStage()) {
        const stage = e.target.getStage();
        const pos = stage?.getPointerPosition();
        if (pos && scene) {
          // Convert from display coords back to scene coords.
          const sx = pos.x / displayScale;
          const sy = pos.y / displayScale;
          const hit = isPointInsideAnyPart(sx, sy, parts);
          if (hit) {
            selectPart(hit);
            return;
          }
        }
        clearSelection();
      }
    },
    [scene, parts, displayScale, clearSelection, selectPart],
  );

  if (!scene) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        パースを読み込み中…
      </div>
    );
  }

  return (
    <Stage
      ref={stageRef}
      width={Math.round(scene.width * displayScale)}
      height={Math.round(scene.height * displayScale)}
      scaleX={displayScale}
      scaleY={displayScale}
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
      <PartFinishLayer />
      <PartMarkerLayer hover={hover} setHover={setHover} />
    </Stage>
  );
}
