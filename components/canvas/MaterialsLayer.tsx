"use client";

import { Layer, Image as KonvaImage } from "react-konva";
import { useImage } from "@/lib/canvas/useImageCache";
import { useCanvasStore } from "@/lib/canvas/store";
import type { MaterialCatalog } from "@/lib/catalog/schema";
import type { KonvaEventObject } from "konva/lib/Node";

type Props = {
  catalog: MaterialCatalog | null;
};

export function MaterialsLayer({ catalog }: Props) {
  const placedMaterials = useCanvasStore((s) => s.placedMaterials);

  if (!catalog) return <Layer />;

  return (
    <Layer>
      {placedMaterials.map((m) => {
        const entry = catalog.entries.find((e) => e.id === m.entryId);
        if (!entry) return null;
        return (
          <PlacedMaterialNode
            key={m.instanceId}
            instanceId={m.instanceId}
            x={m.x}
            y={m.y}
            src={entry.placementImageUrl}
          />
        );
      })}
    </Layer>
  );
}

type NodeProps = {
  instanceId: string;
  x: number;
  y: number;
  src: string;
};

function PlacedMaterialNode({ instanceId, x, y, src }: NodeProps) {
  const img = useImage(src);
  const select = useCanvasStore((s) => s.select);
  const moveMaterial = useCanvasStore((s) => s.moveMaterial);
  const selectionId = useCanvasStore((s) => s.selectionId);
  const isSelected = selectionId === instanceId;

  if (!img) return null;

  return (
    <KonvaImage
      image={img}
      x={x}
      y={y}
      draggable
      onClick={(e: KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true;
        select(instanceId);
      }}
      onTap={(e: KonvaEventObject<TouchEvent>) => {
        e.cancelBubble = true;
        select(instanceId);
      }}
      onDragStart={() => select(instanceId)}
      onDragEnd={(e) => moveMaterial(instanceId, e.target.x(), e.target.y())}
      stroke={isSelected ? "#2563eb" : undefined}
      strokeWidth={isSelected ? 3 : 0}
      shadowEnabled={isSelected}
      shadowColor="#2563eb"
      shadowBlur={isSelected ? 12 : 0}
      shadowOpacity={isSelected ? 0.6 : 0}
    />
  );
}
