"use client";

import { Fragment } from "react";
import { Layer, Rect, Image as KonvaImage } from "react-konva";
import { useCanvasStore } from "@/lib/canvas/store";
import { useImage } from "@/lib/canvas/useImageCache";
import { resolveAssetUrl } from "@/lib/parts/load";
import type { Part } from "@/lib/parts/types";
import type { FinishOption, TextureBox } from "@/lib/finishes/schema";

// `loadPartsForScene` attaches a per-part `_rev` (FNV-1a of polygon + asset
// filenames) so we can cache-bust mask/shading URLs after /dev/trace edits.
// Browsers (and our `useImageCache` Map) key images by URL — without a query
// string they keep serving the previously-loaded mask even after the file
// on disk changes via the dev API regen.
function bust(url: string, rev: string | undefined): string {
  return rev ? `${url}?v=${rev}` : url;
}

export function PartFinishLayer() {
  const scene = useCanvasStore((s) => s.activeScene);
  const parts = useCanvasStore((s) => s.parts);
  const selections = useCanvasStore((s) => s.partFinishSelections);
  const finishOptions = useCanvasStore((s) => s.finishOptions);
  const optionsRev = useCanvasStore((s) => s.finishOptionsRev);

  if (!scene) return null;

  // One Konva Layer per part with an active selection: Layers are isolated offscreen
  // canvases so the multiply / destination-in chain in one part can't leak to another.
  //
  // Note: the active base variant (Natural/Flat/Sharp) only swaps the canvas
  // backdrop (see CanvasStage). Selected options keep their assigned texture
  // regardless of the active variant — `option.textureUrl` is set by the
  // seed pipeline from `finish-base-overrides.json`, so an option labelled
  // "ﾁｬｲﾅ大理石(黒)" always paints the sharp-base crop even on the natural
  // backdrop. Per-variant lookup (`textureUrlByVariant`) is intentionally
  // unused here.
  return (
    <Fragment>
      {parts.map((part) => {
        const optionId = selections[part.id];
        if (!optionId) return null;
        const option = finishOptions.find((o) => o.id === optionId);
        if (!option) return null;
        const rev = (part as Part & { _rev?: string })._rev;
        // Texture URLs cache-bust on the catalog revision (changes when
        // seed:variants rewrites textureUrl PNG content). Mask + shading
        // cache-bust on the per-part `_rev` (changes when polygon does).
        const textureUrl = option.textureUrl
          ? bust(option.textureUrl, optionsRev)
          : undefined;
        return (
          <Layer key={part.id} listening={false}>
            <PartFinish
              part={part}
              option={option}
              sceneWidth={scene.width}
              sceneHeight={scene.height}
              maskUrl={bust(resolveAssetUrl(scene, part.mask), rev)}
              shadingUrl={
                part.shading
                  ? bust(resolveAssetUrl(scene, part.shading), rev)
                  : undefined
              }
              textureUrl={textureUrl}
              textureBox={option.textureBox}
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
  textureUrl: string | undefined;
  textureBox: TextureBox | undefined;
};

function PartFinish({
  part,
  option,
  sceneWidth,
  sceneHeight,
  maskUrl,
  shadingUrl,
  textureUrl,
  textureBox,
}: PartFinishProps) {
  const mask = useImage(maskUrl);
  const shading = useImage(part.renderMode === "color" ? shadingUrl : undefined);
  const texture = useImage(
    part.renderMode === "texture" ? textureUrl : undefined,
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
  // If the resolved texture has a bbox (either from the per-variant entry
  // or the option's legacy textureBox), paint it at the recorded scene
  // coords. Otherwise paint full-scene. The mask is always drawn full-scene
  // so the destination-in clips correctly across the whole canvas.
  void option;
  const tx = textureBox?.x ?? 0;
  const ty = textureBox?.y ?? 0;
  const tw = textureBox?.width ?? sceneWidth;
  const th = textureBox?.height ?? sceneHeight;
  return (
    <Fragment>
      <KonvaImage
        image={texture}
        x={tx}
        y={ty}
        width={tw}
        height={th}
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
