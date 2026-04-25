"use client";

import { Fragment } from "react";
import { Layer, Rect, Image as KonvaImage } from "react-konva";
import { useCanvasStore } from "@/lib/canvas/store";
import { useImage } from "@/lib/canvas/useImageCache";
import type { ScenePart } from "@/lib/scenes/types";

export function ColorCompositeLayer() {
  const scene = useCanvasStore((s) => s.activeScene);
  const overrides = useCanvasStore((s) => s.colorOverrides);

  if (!scene) return null;

  // Each part with an override gets its OWN Konva Layer. Konva Layers each have a
  // dedicated offscreen canvas, so the multiply + destination-in composite chain inside
  // one part cannot leak into a sibling part's canvas. The Layers then composite onto
  // the Stage with normal "source-over" — that's the cross-part isolation guarantee.
  return (
    <Fragment>
      {scene.parts.map((part) => {
        const color = overrides[part.id];
        if (!color) return null;
        return (
          <Layer key={part.id} listening={false}>
            <PartOverride
              part={part}
              color={color}
              sceneWidth={scene.width}
              sceneHeight={scene.height}
            />
          </Layer>
        );
      })}
    </Fragment>
  );
}

type PartOverrideProps = {
  part: ScenePart;
  color: string;
  sceneWidth: number;
  sceneHeight: number;
};

function PartOverride({
  part,
  color,
  sceneWidth,
  sceneHeight,
}: PartOverrideProps) {
  const mask = useImage(part.maskUrl);
  const shading = useImage(part.shadingUrl);

  if (!mask || !shading) return null;

  // Stack inside the group, drawn in order:
  //   1. shading image at full scene size (becomes destination)
  //   2. color Rect with globalCompositeOperation="multiply" — destination becomes (shading × color)
  //      everywhere, including outside the part region
  //   3. mask image with globalCompositeOperation="destination-in" — keeps the (shading × color)
  //      result only where mask alpha > 0, clears everything else to fully transparent
  // The mask MUST be applied last: if the multiply is performed after the mask, the multiply
  // composite leaks beyond the masked region (the empty alpha-0 regions get painted by the
  // shading image's RGB, producing gray smears over unrelated parts).
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
        fill={color}
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
