"use client";

import { Fragment, type ReactNode } from "react";
import { Line, Circle } from "react-konva";

import type { Polygon } from "@/lib/parts/types";
import { type RingAddress, sameRing } from "@/lib/polygon/rings";

// Konva shapes for editing a multi-ring polygon set: one <Line> per ring plus
// a draggable <Circle> handle per vertex.
//
// This component is deliberately mode-agnostic — it knows nothing about parts
// manifests, dev APIs, localStorage drafts, mask regeneration, or IndexedDB.
// It takes geometry in and reports intent out, which is what lets the same
// editing behaviour run inside `/dev/trace` (dev/preview only) and inside the
// exterior facade zone editor (reachable in production).
//
// It returns bare shapes rather than a <Layer> so the caller controls layering
// and can render its own affordances (a part marker, a zone label) above the
// handles in the same layer.

export type PolygonEditorStyle = {
  /** Stroke of outer rings. */
  outerStroke: string;
  /** Stroke of hole rings. Holes read as "cut away", so they contrast. */
  holeStroke?: string;
  /** Translucent fill of the active outer ring. */
  activeFill?: string;
  /** Translucent fill of inactive outer rings. */
  inactiveFill?: string;
};

const DEFAULT_STYLE = {
  holeStroke: "#DC2626",
  holeHandleFill: "#FEE2E2",
  activeFill: "rgba(59,130,246,0.10)",
  inactiveFill: "rgba(59,130,246,0.04)",
} as const;

export type PolygonEditorProps = {
  polygons: ReadonlyArray<Polygon>;
  /** The ring receiving appended vertices. Rendered emphasized. */
  activeRing: RingAddress;
  /**
   * Stage scale. Handle radii and stroke widths are divided by it so the
   * affordances stay a constant size on screen at any zoom.
   */
  displayScale: number;
  style: PolygonEditorStyle;
  /** Key prefix, so several editors can share one Layer without key collisions. */
  keyPrefix?: string;
  onActivateRing: (at: RingAddress) => void;
  onVertexDragStart: () => void;
  onVertexDragMove: (
    at: RingAddress,
    vertexIndex: number,
    x: number,
    y: number,
  ) => void;
  onVertexDragEnd: () => void;
  onVertexDelete: (at: RingAddress, vertexIndex: number) => void;
};

export function PolygonEditor({
  polygons,
  activeRing,
  displayScale,
  style,
  keyPrefix = "pe",
  onActivateRing,
  onVertexDragStart,
  onVertexDragMove,
  onVertexDragEnd,
  onVertexDelete,
}: PolygonEditorProps) {
  const holeStroke = style.holeStroke ?? DEFAULT_STYLE.holeStroke;
  const activeFill = style.activeFill ?? DEFAULT_STYLE.activeFill;
  const inactiveFill = style.inactiveFill ?? DEFAULT_STYLE.inactiveFill;

  // Constant ~2 px on screen regardless of stage scale.
  const handleRadius = 2 / displayScale;
  const holeRadius = 1.75 / displayScale;
  const handleStroke = 0.75 / displayScale;

  // Every <Line> is listening={false}: the fill must not swallow clicks, or
  // click-to-add-vertex dies inside the polygon and right-clicks meant for a
  // vertex handle land on the Line beneath it instead. Clicks belong to the
  // Stage handler, which routes them through the edge-midpoint rule.
  const lines: ReactNode[] = [];
  polygons.forEach((poly, pi) => {
    const isActiveOuter = sameRing(activeRing, { kind: "outer", polygonIndex: pi });
    lines.push(
      <Line
        key={`${keyPrefix}-p${pi}-outer`}
        points={poly.outer.flatMap(([x, y]) => [x, y])}
        closed
        stroke={style.outerStroke}
        strokeWidth={isActiveOuter ? 6 : 3}
        opacity={isActiveOuter ? 1 : 0.45}
        fill={isActiveOuter ? activeFill : inactiveFill}
        listening={false}
      />,
    );
    poly.holes?.forEach((hole, hi) => {
      const isActiveHole = sameRing(activeRing, {
        kind: "hole",
        polygonIndex: pi,
        holeIndex: hi,
      });
      lines.push(
        <Line
          key={`${keyPrefix}-p${pi}-hole-${hi}`}
          points={hole.flatMap(([x, y]) => [x, y])}
          closed
          stroke={holeStroke}
          strokeWidth={isActiveHole ? 5 : 3}
          dash={[8, 6]}
          opacity={isActiveHole ? 1 : 0.5}
          listening={false}
        />,
      );
    });
  });

  // Vertex handles stay listening (Konva's default) so they keep receiving
  // onContextMenu for right-click delete and the drag events. Each handler
  // takes an explicit ring address rather than reading `activeRing` from the
  // closure, which would stale-close over the previous render's value during
  // a drag burst.
  const handles: ReactNode[] = [];
  polygons.forEach((poly, pi) => {
    const outerTarget: RingAddress = { kind: "outer", polygonIndex: pi };
    poly.outer.forEach((v, i) => {
      handles.push(
        <Circle
          key={`${keyPrefix}-p${pi}-outer-v${i}`}
          x={v[0]}
          y={v[1]}
          radius={handleRadius}
          fill="#ffffff"
          stroke={style.outerStroke}
          strokeWidth={handleStroke}
          draggable
          onMouseDown={() => onActivateRing(outerTarget)}
          onDragStart={onVertexDragStart}
          onDragMove={(ev) =>
            onVertexDragMove(outerTarget, i, ev.target.x(), ev.target.y())
          }
          onDragEnd={onVertexDragEnd}
          onContextMenu={(ev) => {
            ev.evt.preventDefault();
            onVertexDelete(outerTarget, i);
          }}
        />,
      );
    });
    poly.holes?.forEach((hole, hi) => {
      const holeTarget: RingAddress = {
        kind: "hole",
        polygonIndex: pi,
        holeIndex: hi,
      };
      hole.forEach((v, i) => {
        handles.push(
          <Circle
            key={`${keyPrefix}-p${pi}-hole-${hi}-v${i}`}
            x={v[0]}
            y={v[1]}
            radius={holeRadius}
            fill={DEFAULT_STYLE.holeHandleFill}
            stroke={holeStroke}
            strokeWidth={handleStroke}
            draggable
            onMouseDown={() => onActivateRing(holeTarget)}
            onDragStart={onVertexDragStart}
            onDragMove={(ev) =>
              onVertexDragMove(holeTarget, i, ev.target.x(), ev.target.y())
            }
            onDragEnd={onVertexDragEnd}
            onContextMenu={(ev) => {
              ev.evt.preventDefault();
              onVertexDelete(holeTarget, i);
            }}
          />,
        );
      });
    });
  });

  return (
    <Fragment>
      {lines}
      {handles}
    </Fragment>
  );
}
