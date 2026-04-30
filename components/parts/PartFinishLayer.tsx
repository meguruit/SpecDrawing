"use client";

import { Fragment, useEffect } from "react";
import { Layer, Rect, Image as KonvaImage } from "react-konva";
import { useCanvasStore } from "@/lib/canvas/store";
import { useImage, prefetchImages } from "@/lib/canvas/useImageCache";
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
  const activeVariantKey = useCanvasStore((s) => s.activeVariantKey);

  // Pre-fetch the inactive variants of every selected texture-mode option,
  // so a variant switch swaps from the cache without a visible reload.
  useEffect(() => {
    if (!activeVariantKey) return;
    const urls: string[] = [];
    for (const partId of Object.keys(selections)) {
      const part = parts.find((p) => p.id === partId);
      if (!part || part.renderMode !== "texture") continue;
      const opt = finishOptions.find((o) => o.id === selections[partId]);
      const map = opt?.textureUrlByVariant;
      if (!map) continue;
      for (const [key, entry] of Object.entries(map)) {
        if (key === activeVariantKey) continue;
        urls.push(optionsRev ? `${entry.url}?v=${optionsRev}` : entry.url);
      }
    }
    prefetchImages(urls);
  }, [selections, parts, finishOptions, activeVariantKey, optionsRev]);

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
        const rev = (part as Part & { _rev?: string })._rev;
        // For texture-mode parts on a variant-enabled sheet, prefer the
        // per-variant entry; otherwise fall back to the legacy textureUrl.
        // Texture URLs cache-bust on the catalog revision (changes when
        // seed:variants rewrites texture PNG content). Mask + shading
        // cache-bust on the per-part `_rev` (changes when polygon does).
        let resolvedTextureUrl: string | undefined;
        let resolvedTextureBox = option.textureBox;
        if (
          part.renderMode === "texture" &&
          activeVariantKey &&
          option.textureUrlByVariant?.[activeVariantKey]
        ) {
          const entry = option.textureUrlByVariant[activeVariantKey];
          resolvedTextureUrl = entry.url;
          resolvedTextureBox = entry.textureBox ?? option.textureBox;
        } else {
          resolvedTextureUrl = option.textureUrl;
        }
        const bustedTexture = resolvedTextureUrl
          ? bust(resolvedTextureUrl, optionsRev)
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
              textureUrl={bustedTexture}
              textureBox={resolvedTextureBox}
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
