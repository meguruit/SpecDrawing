"use client";

import { Fragment, useMemo } from "react";
import { Layer, Circle, Text, Line } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCanvasStore } from "@/lib/canvas/store";
import type { Part } from "@/lib/parts/types";
import { findPartAt } from "@/lib/parts/hitTest";

const CATEGORY_COLOR: Record<string, string> = {
  キッチン: "#F97316",
  照明: "#F59E0B",
  玄関: "#FBBF24",
  室内建具: "#3B82F6",
  床材: "#10B981",
  収納アクセント: "#F97316",
  サッシ: "#EF4444",
};

function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? "#64748B";
}

const CIRCLED_DIGITS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
function partGlyph(id: string): string {
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n >= 1 && n <= 20
    ? CIRCLED_DIGITS[n - 1]
    : `#${id}`;
}

type PolygonHover = { partId: string } | null;

export function PartMarkerLayer({
  hover,
  setHover,
}: {
  hover: PolygonHover;
  setHover: (h: PolygonHover) => void;
}) {
  const parts = useCanvasStore((s) => s.parts);
  const selectedPartId = useCanvasStore((s) => s.selectedPartId);
  const selectPart = useCanvasStore((s) => s.selectPart);
  const visible = useCanvasStore((s) => s.markersVisible);

  if (!visible) return null;

  return (
    <Layer>
      {parts.map((part) => (
        <PartMarker
          key={part.id}
          part={part}
          isSelected={selectedPartId === part.id}
          isHovered={hover?.partId === part.id}
          onSelect={() => selectPart(part.id)}
          onHoverChange={(h) => setHover(h ? { partId: part.id } : null)}
        />
      ))}
    </Layer>
  );
}

function PartMarker({
  part,
  isSelected,
  isHovered,
  onSelect,
  onHoverChange,
}: {
  part: Part;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const color = categoryColor(part.category);

  // Each polygon entry contributes one outer hit-target Line plus a dashed
  // outline Line, and each hole contributes its own outline (no hit-target —
  // clicks inside a hole fall through).
  const rings = useMemo(() => {
    const out: Array<{
      key: string;
      kind: "outer" | "hole";
      points: number[];
    }> = [];
    part.polygons.forEach((poly, pi) => {
      out.push({
        key: `p${pi}-outer`,
        kind: "outer",
        points: poly.outer.flatMap(([x, y]) => [x, y]),
      });
      poly.holes?.forEach((hole, hi) => {
        out.push({
          key: `p${pi}-hole-${hi}`,
          kind: "hole",
          points: hole.flatMap(([x, y]) => [x, y]),
        });
      });
    });
    return out;
  }, [part.polygons]);

  const showOutline = isSelected || isHovered;

  return (
    <Fragment>
      {rings.map((r) =>
        r.kind === "outer" ? (
          // Outer rings: hit-target with a near-transparent fill so clicks
          // inside the region select the part. Mouse hover toggles outline.
          <Line
            key={r.key}
            points={r.points}
            closed
            stroke={showOutline ? color : undefined}
            strokeWidth={showOutline ? 6 : 0}
            dash={showOutline ? [16, 12] : undefined}
            fill="rgba(0,0,0,0.001)"
            listening
            hitStrokeWidth={0}
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
            onClick={(e: KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true;
              onSelect();
            }}
            onTap={(e: KonvaEventObject<TouchEvent>) => {
              e.cancelBubble = true;
              onSelect();
            }}
          />
        ) : (
          // Hole rings: outline only, no hit-target. Use a shorter dash
          // pattern to distinguish from outer rings on hover.
          showOutline ? (
            <Line
              key={r.key}
              points={r.points}
              closed
              stroke={color}
              strokeWidth={4}
              dash={[6, 6]}
              listening={false}
            />
          ) : null
        ),
      )}
      {/* Numbered marker */}
      <Circle
        x={part.marker.x}
        y={part.marker.y}
        radius={28}
        fill={color}
        stroke="#ffffff"
        strokeWidth={4}
        shadowColor="rgba(0,0,0,0.3)"
        shadowBlur={4}
        shadowOffset={{ x: 0, y: 1 }}
        listening
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onClick={(e: KonvaEventObject<MouseEvent>) => {
          e.cancelBubble = true;
          onSelect();
        }}
        onTap={(e: KonvaEventObject<TouchEvent>) => {
          e.cancelBubble = true;
          onSelect();
        }}
      />
      <Text
        text={partGlyph(part.id)}
        x={part.marker.x - 28}
        y={part.marker.y - 22}
        width={56}
        height={44}
        fontSize={36}
        fontStyle="bold"
        fill="#ffffff"
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </Fragment>
  );
}

// Programmatic hit-test for callers outside the marker layer (e.g.
// click-on-stage handlers that need to know which part a coordinate falls
// into without going through Konva's event system).
export function isPointInsideAnyPart(
  x: number,
  y: number,
  parts: Part[],
): string | null {
  return findPartAt(x, y, parts);
}
