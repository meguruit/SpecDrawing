"use client";

import { Fragment } from "react";
import { Layer, Rect, Image as KonvaImage } from "react-konva";
import { useCanvasStore } from "@/lib/canvas/store";
import { useImage } from "@/lib/canvas/useImageCache";
import { resolveAssetUrl } from "@/lib/parts/load";
import type { Part } from "@/lib/parts/types";
import type { FinishOption } from "@/lib/finishes/schema";

export function PartFinishLayer() {
  const scene = useCanvasStore((s) => s.activeScene);
  const parts = useCanvasStore((s) => s.parts);
  const selections = useCanvasStore((s) => s.partFinishSelections);
  const finishOptions = useCanvasStore((s) => s.finishOptions);

  if (!scene) return null;

  // One Konva Layer per part with an active selection: Layers are isolated offscreen
  // canvases so the multiply / destination-in chain in one part can't leak to another.
  return (
    <Fragment>
      {parts.map((part) => {
        const optionId = selections[part.id];
        if (!optionId) return null;
        const option = finishOptions.find((o) => o.id === optionId);
        if (!option) return null;
        return (
          <Layer key={part.id} listening={false}>
            <PartFinish
              part={part}
              option={option}
              sceneWidth={scene.width}
              sceneHeight={scene.height}
              maskUrl={resolveAssetUrl(scene, part.mask)}
              shadingUrl={
                part.shading ? resolveAssetUrl(scene, part.shading) : undefined
              }
            />
          </Layer>
        );
      })}
    </Fragment>
  );
}

type PartFinishProps = {
  part: Part;
  option: FinishOption;
  sceneWidth: number;
  sceneHeight: number;
  maskUrl: string;
  shadingUrl: string | undefined;
};

function PartFinish({
  part,
  option,
  sceneWidth,
  sceneHeight,
  maskUrl,
  shadingUrl,
}: PartFinishProps) {
  const mask = useImage(maskUrl);
  const shading = useImage(part.renderMode === "color" ? shadingUrl : undefined);
  const texture = useImage(
    part.renderMode === "texture" ? option.textureUrl : undefined,
  );

  if (!mask) return null;

  if (part.renderMode === "color") {
    if (!shading || !option.colorHex) return null;
    // Order: shading → color rect (multiply) → mask (destination-in)
    return (
      <Fragment>
        <KonvaImage
          image={shading}
          x={0}
          y={0}
          width={sceneWidth}
          height={sceneHeight}
          listening={false}
        />
        <Rect
          x={0}
          y={0}
          width={sceneWidth}
          height={sceneHeight}
          fill={option.colorHex}
          globalCompositeOperation="multiply"
        />
        <KonvaImage
          image={mask}
          x={0}
          y={0}
          width={sceneWidth}
          height={sceneHeight}
          globalCompositeOperation="destination-in"
          listening={false}
        />
      </Fragment>
    );
  }

  // texture mode: texture image → mask (destination-in)
  if (!texture) return null;
  return (
    <Fragment>
      <KonvaImage
        image={texture}
        x={0}
        y={0}
        width={sceneWidth}
        height={sceneHeight}
        listening={false}
      />
      <KonvaImage
        image={mask}
        x={0}
        y={0}
        width={sceneWidth}
        height={sceneHeight}
        globalCompositeOperation="destination-in"
        listening={false}
      />
    </Fragment>
  );
}
