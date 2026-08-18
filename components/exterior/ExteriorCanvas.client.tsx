"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";

import { useImage } from "@/lib/canvas/useImageCache";
import { PolygonEditor } from "@/components/polygon/PolygonEditor";
import { ZoneFillLayer } from "./ZoneFillLayer";
import {
  useExteriorStore,
  selectActiveAngle,
  selectSelectedZone,
} from "@/lib/exterior/store";
import { registerExportStage } from "@/lib/export/stage-capture";
import { EDGE_INSERT_TOLERANCE_PX, nearestEdgeAcrossRings } from "@/lib/polygon/interactions";
import * as rings from "@/lib/polygon/rings";
import { findByCode } from "@/lib/jolypate/load";
import type { JolypateColor } from "@/lib/jolypate/schema";
import type { Vertex } from "@/lib/parts/types";

const MAX_DISPLAY_WIDTH = 1100;
const MAX_DISPLAY_HEIGHT = 760;

export default function ExteriorCanvas({ colors }: { colors: JolypateColor[] }) {
  const stageRef = useRef<Konva.Stage>(null);
  const angle = useExteriorStore(selectActiveAngle);
  const zone = useExteriorStore(selectSelectedZone);
  const imageUrl = useExteriorStore((s) => s.imageUrl);
  const activeRing = useExteriorStore((s) => s.activeRing);
  const dragging = useExteriorStore((s) => s.dragging);
  const setActiveRing = useExteriorStore((s) => s.setActiveRing);
  const updateZoneGeometry = useExteriorStore((s) => s.updateZoneGeometry);
  const addZone = useExteriorStore((s) => s.addZone);
  const selectZone = useExteriorStore((s) => s.selectZone);
  const beginDrag = useExteriorStore((s) => s.beginDrag);
  const endDrag = useExteriorStore((s) => s.endDrag);
  const notify = useExteriorStore((s) => s.notify);

  const baseImage = useImage(imageUrl ?? undefined);

  // Fit the perspective on screen; internal coordinates stay at native pixels
  // so zone geometry is resolution-independent.
  const displayScale = useMemo(() => {
    if (!angle) return 1;
    return Math.min(
      1,
      MAX_DISPLAY_WIDTH / angle.width,
      MAX_DISPLAY_HEIGHT / angle.height,
    );
  }, [angle]);

  // Publish the stage so the page can drive PNG export.
  useEffect(() => {
    registerExportStage(() => stageRef.current);
    return () => registerExportStage(null);
  }, []);

  useEffect(() => {
    useExteriorStore.setState({});
  }, [displayScale]);

  const colorFor = useCallback(
    (code: string | null) => findByCode(colors, code),
    [colors],
  );

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Konva fires `click` for every button; right-click deletion is handled
      // per-vertex, and without this the follow-up click re-adds the vertex
      // that was just removed.
      if ("button" in e.evt && e.evt.button !== 0) return;
      if (e.target !== e.target.getStage()) return;
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos || !angle) return;
      const x = pos.x / displayScale;
      const y = pos.y / displayScale;

      if (!zone) {
        // No zone selected: start one. Three clicks make it a ring.
        addZone([{ outer: [[x, y]] as Vertex[] }]);
        return;
      }

      const tol = EDGE_INSERT_TOLERANCE_PX / displayScale;
      const hit = nearestEdgeAcrossRings(zone.polygons, [x, y], tol);
      if (hit) {
        updateZoneGeometry(
          zone.id,
          rings.insertVertexAfter(zone.polygons, hit.ring, hit.edgeIndex, hit.foot as Vertex),
        );
        setActiveRing(hit.ring);
      } else {
        updateZoneGeometry(
          zone.id,
          rings.appendVertex(zone.polygons, activeRing, [x, y] as Vertex),
        );
      }
    },
    [angle, zone, displayScale, activeRing, addZone, updateZoneGeometry, setActiveRing],
  );

  const handleVertexDragMove = useCallback(
    (at: rings.RingAddress, index: number, x: number, y: number) => {
      if (!zone) return;
      // checkpoint:false — the drag pushed one history entry on mousedown, so
      // a hundred move events stay a single undo step.
      updateZoneGeometry(
        zone.id,
        rings.moveVertex(zone.polygons, at, index, [x, y] as Vertex),
        { checkpoint: false },
      );
    },
    [zone, updateZoneGeometry],
  );

  const handleVertexDelete = useCallback(
    (at: rings.RingAddress, index: number) => {
      if (!zone) return;
      if (rings.wouldUnderflow(zone.polygons, at)) {
        notify(`頂点は 3 つ必要です（これ以上削除するとゾーンが面になりません）`);
        return;
      }
      updateZoneGeometry(zone.id, rings.deleteVertex(zone.polygons, at, index));
    },
    [zone, updateZoneGeometry, notify],
  );

  if (!angle) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        アングルを追加してください
      </div>
    );
  }

  return (
    <Stage
      ref={stageRef}
      width={Math.round(angle.width * displayScale)}
      height={Math.round(angle.height * displayScale)}
      scaleX={displayScale}
      scaleY={displayScale}
      onClick={handleStageClick}
      onTap={handleStageClick}
      style={{ background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}
    >
      <Layer listening={false}>
        {baseImage && (
          <KonvaImage
            image={baseImage}
            x={0}
            y={0}
            width={angle.width}
            height={angle.height}
          />
        )}
      </Layer>

      {/* Every zone in one Layer; each is a cached Group, which is what keeps
          its destination-in clip from touching its siblings. Declaration
          order is stacking order. */}
      <Layer listening={false}>
        {angle.zones.map((z) => (
          <ZoneFillLayer
            key={z.id}
            zone={z}
            color={colorFor(z.colorCode)}
            width={angle.width}
            height={angle.height}
            live={dragging && z.id === zone?.id}
          />
        ))}
      </Layer>

      {/* Editing affordances sit above every fill, so handles stay visible
          over dark colours. Excluded from export by the capture helper. */}
      <Layer name="editor-chrome">
        {zone && (
          <PolygonEditor
            polygons={zone.polygons}
            activeRing={activeRing}
            displayScale={displayScale}
            style={{ outerStroke: "#0F172A" }}
            keyPrefix={zone.id}
            onActivateRing={setActiveRing}
            onVertexDragStart={beginDrag}
            onVertexDragMove={handleVertexDragMove}
            onVertexDragEnd={endDrag}
            onVertexDelete={handleVertexDelete}
          />
        )}
      </Layer>
    </Stage>
  );
}

/** Selecting a zone by clicking its filled area, for the zone list to reuse. */
export function useSelectZone() {
  return useExteriorStore((s) => s.selectZone);
}
