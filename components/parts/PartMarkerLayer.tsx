"use client";

import { Fragment, useMemo } from "react";
import { Layer, Circle, Text, Line } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useCanvasStore } from "@/lib/canvas/store";
import type { Part } from "@/lib/parts/types";

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

function pointInPolygon(
  x: number,
  y: number,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
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

  // Flatten polygon for Konva Line.
  const flatPoints = useMemo(
    () => part.polygon.flatMap(([x, y]) => [x, y]),
    [part.polygon],
  );

  const showOutline = isSelected || isHovered;

  return (
    <Fragment>
      {/* Invisible polygon for hit-testing the whole part region */}
      <Line
        points={flatPoints}
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

export function isPointInsideAnyPart(
  x: number,
  y: number,
  parts: Part[],
): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (pointInPolygon(x, y, p.polygon)) return p.id;
  }
  return null;
}
