"use client";

import { useEffect, useMemo, useRef } from "react";
import { Group, Rect, Shape, Image as KonvaImage } from "react-konva";
import type Konva from "konva";

import { useImage } from "@/lib/canvas/useImageCache";
import type { FacadeZone } from "@/lib/exterior/types";
import type { JolypateColor } from "@/lib/jolypate/schema";

// Composition of one facade zone over the uploaded white perspective.
//
// The white perspective already carries the lighting — surface shading, cast
// shadows, ambient occlusion are baked into it. So the colour is *multiplied*
// over it and the perspective itself acts as the shading map. There is no
// separate shading asset for exterior zones, and there is no mask PNG: the
// clip is a path drawn at composite time.
//
// Draw order inside the group, which must not change:
//
//   1. colour Rect      globalCompositeOperation="multiply", opacity=zone.opacity
//   2. finish texture   globalCompositeOperation="soft-light"   (optional)
//   3. mask Shape       globalCompositeOperation="destination-in"  <- LAST
//
// The mask goes last for the same reason it does in the interior compositor:
// Canvas2D's `multiply` paints source RGB straight onto zero-alpha
// destination pixels, so clipping first and painting second smears colour
// outside the zone.
//
// Each zone is its own **cached** Group. Caching gives the group a private
// offscreen canvas, which is what confines `destination-in` to this zone
// instead of erasing siblings and the base image. One Layer per zone would
// isolate them too, but exterior projects can carry dozens of zones and Konva
// allocates a DOM canvas per Layer.

const SANDSTONE_URL = "/assets/jolypate/sandstone.jpg";

/** FNV-1a over the fields that affect this zone's pixels. */
function renderKey(zone: FacadeZone, colorHex: string | null): string {
  const src = JSON.stringify([zone.polygons, colorHex, zone.opacity, zone.finishTexture]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export type ZoneFillLayerProps = {
  zone: FacadeZone;
  color: JolypateColor | null;
  width: number;
  height: number;
  /** True while this zone is being dragged: skip caching so edits show live. */
  live: boolean;
};

export function ZoneFillLayer({ zone, color, width, height, live }: ZoneFillLayerProps) {
  const groupRef = useRef<Konva.Group>(null);
  const texture = useImage(zone.finishTexture === "sandstone" ? SANDSTONE_URL : undefined);
  const key = useMemo(() => renderKey(zone, color?.colorHex ?? null), [zone, color]);

  // Re-cache whenever the zone's rendered appearance changes. Caching an
  // empty or in-flight group would freeze a stale bitmap, so the key covers
  // every field the drawing reads.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    if (live) {
      // Mid-drag: draw straight to the layer so the geometry tracks the
      // pointer. Isolation is momentarily lost, which is invisible because
      // the drag ends in a re-cache.
      g.clearCache();
      return;
    }
    g.cache();
    g.getLayer()?.batchDraw();
  }, [key, live, texture]);

  if (!color) return null;

  return (
    <Group ref={groupRef} listening={false}>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill={color.colorHex}
        opacity={zone.opacity}
        globalCompositeOperation="multiply"
      />

      {zone.finishTexture === "sandstone" && texture && (
        // The tile is normalized to mean luminance 0.5, so soft-light adds
        // grain without shifting the colour's overall value.
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          fillPatternImage={texture}
          fillPatternRepeat="repeat"
          globalCompositeOperation="soft-light"
        />
      )}

      <Shape
        globalCompositeOperation="destination-in"
        sceneFunc={(ctx) => {
          // Build the whole zone as one Path2D and fill it with the even-odd
          // rule, so hole rings punch through. Konva's `clipFunc` cannot
          // express a fill rule, which is why this is a destination-in fill
          // rather than a clip.
          const path = new Path2D();
          for (const poly of zone.polygons) {
            if (poly.outer.length < 3) continue;
            path.moveTo(poly.outer[0][0], poly.outer[0][1]);
            for (let i = 1; i < poly.outer.length; i++) {
              path.lineTo(poly.outer[i][0], poly.outer[i][1]);
            }
            path.closePath();
            for (const hole of poly.holes ?? []) {
              if (hole.length < 3) continue;
              path.moveTo(hole[0][0], hole[0][1]);
              for (let i = 1; i < hole.length; i++) {
                path.lineTo(hole[i][0], hole[i][1]);
              }
              path.closePath();
            }
          }
          // Reach past Konva's Context wrapper: fill(path, fillRule) is a
          // raw Canvas2D call the wrapper does not forward.
          const raw = (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
          raw.fillStyle = "#000";
          raw.fill(path, "evenodd");
        }}
      />
    </Group>
  );
}

/** Hidden preloader so the texture is warm before a zone first enables it. */
export function SandstonePreload() {
  const img = useImage(SANDSTONE_URL);
  return img ? <KonvaImage image={img} x={0} y={0} width={0} height={0} listening={false} /> : null;
}
