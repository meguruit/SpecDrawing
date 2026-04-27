## Why

Several finish options for kitchen / lighting / entry parts are not naturally expressible as either a flat colorway (color-mode) or a generic texture overlay (texture-mode using a workbook swatch tiled to fill the part). Door panels, range hoods, ceiling-light fixtures and entry-floor tile patterns each have **fixture-specific lighting, shadows, and edge details** that only look right when a designer renders the entire scene with that finish in place. The customer is producing such full-scene renders — a "natural" finish render, a "sharp" (e.g. black hardware) render, and a "flat" (e.g. matte stone tile) render. What they want from the runtime is: when a designer picks "ﾁｬｲﾅ大理石(黒)" for ① キッチン天板, swap **the kitchen-counter region's pixels** to the corresponding region of the "sharp" render — leaving the rest of the perspective (which uses the "natural" finish) untouched.

The seed-side workbook swatches we ship today don't capture these fixture-specific details. The current system can either tint a flat color or stretch a small swatch over the whole mask — both wrong for these parts.

## What Changes

- **Rename** `resources/base/ベースパース.jpg` → `resources/base/ベースパース_natural.jpg`. The "natural" perspective continues to be the default canvas backdrop; `public/assets/base/main/base.jpg` is renamed to `base_natural.jpg` and `scene.json`'s `baseImageUrl` is updated.
- **Multiple base perspectives per scene**: a scene SHALL accept multiple full-scene perspective renders sharing the same dimensions and camera. Each is a "variant" identified by a key (`natural` | `sharp` | `flat` | extensible). The default variant remains the canvas backdrop.
- **Per-option variant override config** at `resources/catalog/finish-base-overrides.json` (designer-edited) maps `(partId, optionLabel)` → variant key. The initial config encodes:

  | Part | Option | Variant |
  |---|---|---|
  | ① キッチン天板 | ﾁｬｲﾅ大理石(黒) | sharp |
  | ① キッチン天板 | ﾁｬｲﾅ大理石(白) | natural |
  | ⑤ レンジフード | ブラック | sharp |
  | ⑤ レンジフード | ホワイト | natural |
  | ⑥ 吊り棚金具 | ブラック | sharp |
  | ⑥ 吊り棚金具 | ホワイト | natural |
  | ⑧ キッチン下タイル | ｼｬﾝﾊﾟﾝﾎﾜｲﾄ | natural |
  | ⑧ キッチン下タイル | ｱｰｽｽﾄｰﾝ | sharp |
  | ⑨ スポットライト | ブラック | sharp |
  | ⑨ スポットライト | ホワイト | natural |
  | ⑫ 玄関床 | ｸﾚﾏﾌﾞﾛｯｸ | flat |
  | ⑫ 玄関床 | ｵﾝﾌﾀﾞｶﾞﾀﾗｲﾄ | natural |
  | ⑫ 玄関床 | ﾜｲﾄﾞﾓﾙﾀﾙ | sharp |

- **New seed step** `npm run seed:variants` (script `scripts/cut-base-variants.mjs`): for every (part, option) in the override config, load the variant base, mask it by the part's mask, and write the cropped piece to `public/assets/finishes/<partId>/<optionId>.png`. Update `finish-options.json` so each overridden option's `textureUrl` points at the cropped piece. Options without override entries keep their existing behavior.
- **Render-mode change**: ⑫ 玄関床 switches from `color` to `texture` so the runtime composites the cropped piece (currently it tints with HEX). All other affected parts (① ⑤ ⑥ ⑧ ⑨) are already `texture` and need no spec change.
- **Missing-variant fallback**: when a variant base file does not exist on disk yet (the customer hasn't supplied it), the seed script emits an entry into `finish-options.warnings.json` and leaves the option's `textureUrl` unchanged from the previous seed run. The runtime keeps showing the workbook-swatch fallback until the variant base lands.
- **Pipeline order**: `seed:parts` (workbook → JSON + per-option swatches) → `seed:masks` (parts.json polygons → mask + shading PNGs) → `seed:variants` (override config + variant bases → per-option cropped textures, overwriting the swatches). Each step is independently rerunnable.

Explicit non-goals:

- No runtime changes: composition stays as `mask × texture` (existing texture-mode pipeline). The work is entirely in the seed pipeline + asset layout + one parts.json render-mode flip.
- No UI for editing overrides — the override config is hand-edited in `resources/catalog/finish-base-overrides.json` (or via /dev/trace in a future change).
- No automatic variant detection from the workbook — the override map is explicit.
- No per-sheet override differentiation in this change — the same `(partId, optionLabel)` resolves to the same variant on every sheet.

## Capabilities

### New Capabilities
<!-- None — all spec changes belong to existing capabilities. -->

### Modified Capabilities
- `base-perspective-registry`: scenes now describe multiple variant base perspectives (one default).
- `finish-spec-catalog`: option `textureUrl` may point at a base-variant-cropped piece produced by the seed pipeline; the new override config + seed step are part of this capability.
- `numbered-part-overlay`: ⑫ 玄関床's render-mode flips from `color` to `texture`; the part's `shading` field is removed accordingly.

## Impact

- **Renamed**: `resources/base/ベースパース.jpg` → `ベースパース_natural.jpg`; `public/assets/base/main/base.jpg` → `base_natural.jpg`; `scene.json` updated.
- **New runtime files** (generated, not committed by hand): `public/assets/finishes/<partId>/<optionId>.png` for the 13 overridden options listed above; `public/catalog/finish-options.json` updated to reference them.
- **New source files**: `resources/catalog/finish-base-overrides.json` (designer-editable; committed); `resources/base/ベースパース_sharp.jpg` and `resources/base/ベースパース_flat.jpg` are TBD by the customer (LFS-tracked when they land).
- **New script**: `scripts/cut-base-variants.mjs` (devDep `sharp` already present).
- **`parts.json`**: ⑫ 玄関床 `renderMode` flips `color` → `texture`; `shading: "shading_12.png"` removed. The orphaned `shading_12.png` PNG can stay on disk (ignored at runtime) or be deleted.
- **No new dependencies**.
- **Backward compat**: until variant bases are supplied, every overridden option falls back to its previous workbook-swatch rendering and the warnings file lists which variants are missing — the app keeps running.
