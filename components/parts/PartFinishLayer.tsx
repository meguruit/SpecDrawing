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
  const activeVariantKey = useCanvasStore((s) => s.activeVariantKey);

  if (!scene) return null;

  // One Konva Layer per part with an active selection: Layers are isolated offscreen
  // canvases so the multiply / destination-in chain in one part can't leak to another.
  //
  // Texture resolution rule:
  //   - When `option.defaultForVariants` includes the active variant key,
  //     use `option.textureUrlByVariant[active]` so the part follows the
  //     active variant's base (e.g. ⑭ シルバー spans all 3 variants → render
  //     the active variant's hardware crop; ⑤ ブラック on Flat → render the
  //     flat-base black hood).
  //   - Otherwise use the static `option.textureUrl` so the option's
  //     assigned appearance is preserved (e.g. picking ﾁｬｲﾅ大理石(黒) on
  //     Natural still paints the sharp-base black-marble crop).
  return (
    <Fragment>
      {parts.map((part) => {
        const optionId = selections[part.id];
        if (!optionId) return null;
        const option = finishOptions.find((o) => o.id === optionId);
        if (!option) return null;
        const rev = (part as Part & { _rev?: string })._rev;

        let resolvedTextureUrl: string | undefined = option.textureUrl;
        let resolvedTextureBox = option.textureBox;
        if (
          part.renderMode === "texture" &&
          activeVariantKey &&
          option.defaultForVariants?.includes(activeVariantKey) &&
          option.textureUrlByVariant?.[activeVariantKey]
        ) {
          const entry = option.textureUrlByVariant[activeVariantKey];
          resolvedTextureUrl = entry.url;
          resolvedTextureBox = entry.textureBox ?? option.textureBox;
        }
        // Texture URLs cache-bust on the catalog revision (changes when
        // seed:variants rewrites textureUrl PNG content). Mask + shading
        // cache-bust on the per-part `_rev` (changes when polygon does).
        const bustedTexture = resolvedTextureUrl
          ? bust(resolvedTextureUrl, optionsRev)
          : undefined;
        // Mask resolution precedence (see color-composition "Per-option mask
        // override" / "Per-option mask disable"):
        //   0. option `mask === "no"` (texture mode only) — disables mask
        //      compositing entirely: paint the texture PNG as-is, no clip.
        //   1. the selected option's own `mask` — a full web-root path used
        //      as-is, winning on every active variant; cache-busts on the
        //      catalog `optionsRev` like the option's textureUrl.
        //   2. else the active variant's mask (a different perspective places
        //      the part in a different region);
        //   3. else the part's base mask (no active variant, or no entry).
        // Cases 2/3 resolve relative to the scene dir and cache-bust on the
        // per-part `_rev`. The composite ordering below is unchanged — only
        // which mask PNG is loaded changes. A null `maskUrl` means "no mask".
        let maskUrl: string | null;
        if (option.mask === "no" && part.renderMode === "texture") {
          maskUrl = null;
        } else if (option.mask && option.mask !== "no") {
          maskUrl = bust(option.mask, optionsRev);
        } else {
          const resolvedMask =
            (activeVariantKey && part.maskByVariant?.[activeVariantKey]) ||
            part.mask;
          maskUrl = bust(resolveAssetUrl(scene, resolvedMask), rev);
        }
        return (
          <Layer key={part.id} listening={false}>
            <PartFinish
              part={part}
              option={option}
              sceneWidth={scene.width}
              sceneHeight={scene.height}
              maskUrl={maskUrl}
              shadingUrl={
                part.shading
                  ? bust(resolveAssetUrl(scene, part.shading), rev)
                  : undefined
              }
              textureUrl={bustedTexture}
              textureBox={resolvedTextureBox}
              activeVariantKey={activeVariantKey}
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
  maskUrl: string | null;
  shadingUrl: string | undefined;
  textureUrl: string | undefined;
  textureBox: TextureBox | undefined;
  activeVariantKey: string | null;
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
  activeVariantKey,
}: PartFinishProps) {
  // `maskUrl === null` means the option opted out of masking (mask: "no",
  // texture mode only) — we paint the texture PNG as-is with no clip.
  const noMask = maskUrl === null;
  const mask = useImage(maskUrl ?? undefined);
  const shading = useImage(part.renderMode === "color" ? shadingUrl : undefined);
  const texture = useImage(
    part.renderMode === "texture" ? textureUrl : undefined,
  );

  if (!noMask && !mask) return null;

  if (part.renderMode === "color") {
    // Color mode always clips against a mask (the `mask: "no"` opt-out is
    // texture-only, so `maskUrl` is never null here), but narrow it for TS.
    if (!shading || !option.colorHex || !mask) return null;
    // Per-variant override: when the option declares colorHexByVariant
    // and the active variant has an entry, use it; else fall back to the
    // static colorHex. Lets ⑰ サッシ枠 carry per-variant palettes that
    // harmonize with each base perspective without changing the layered
    // composition order (shading → fill → mask).
    const resolvedColorHex =
      (activeVariantKey && option.colorHexByVariant?.[activeVariantKey]) ||
      option.colorHex;
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
          fill={resolvedColorHex}
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
      {!noMask && mask && (
        <KonvaImage
          image={mask}
          x={0}
          y={0}
          width={sceneWidth}
          height={sceneHeight}
          globalCompositeOperation="destination-in"
          listening={false}
        />
      )}
    </Fragment>
  );
}
