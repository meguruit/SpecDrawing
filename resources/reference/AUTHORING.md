# Authoring Guide — Numbered Parts and Finish Images

This file documents how designers produce the runtime assets under `public/assets/base/<scene-id>/` and `public/assets/finishes/<part-id>/` from the source files staged in `resources/`.

## Source vs. runtime

```
resources/                                    designer source-of-truth (commit, do not serve)
  base/<scene-id>/<source>.jpg                raw perspective JPG (e.g. ベースパース.jpg)
  reference/部材対応番号-<n>.pdf               annotated reference PDFs (numbered parts ① – ⑰)
  catalog/部材リスト.xlsx                      option workbook (Git LFS)

public/                                       runtime, served by Next.js
  assets/base/<scene-id>/base.jpg             native-resolution copy of the source perspective
  assets/base/<scene-id>/scene.json           scene manifest (id, name, dimensions, partsManifestUrl)
  assets/base/<scene-id>/parts.json           numbered-part manifest (① – ⑰)
  assets/base/<scene-id>/mask_<NN>.png        alpha mask per part (scene-resolution)
  assets/base/<scene-id>/shading_<NN>.png     luminance map per color-mode part (scene-resolution)
  assets/finishes/<part-id>/<option-id>.png   per-option swatch (and texture, for texture-mode)
  catalog/scenes.json                         registry index
  catalog/finish-options.json                 generated from the workbook by `npm run seed:parts`
```

## Source perspective

- **File**: `resources/base/main/ベースパース.jpg` → copied at native resolution (no downscale) to `public/assets/base/main/base.jpg`.
- **Native dimensions**: 3000 × 2142 px (read from the source JPG; record in `scene.json`).
- **Camera / framing**: front-on view of the LDK from the living-room corner, kitchen island and back wall centered, sash on the left, entry on the right. All three reference PDFs are annotations on top of this same render.
- Do not re-render the perspective unless the underlying base render changes; if it does, re-trace polygons and re-author masks.

## Numbered parts

Every changeable surface is one of seventeen numbered parts (① – ⑰), enumerated in `部材リスト.xlsx`. The correspondence between number and on-image region is documented across three reference PDFs:

| PDF | Parts annotated |
| --- | --- |
| `部材対応番号-1.pdf` | ⑦ accent cloth (kitchen back wall), ⑨ spotlights/track, ⑩ entry door panel, ⑬ interior door panel |
| `部材対応番号-2.pdf` | ⑫ entry floor, ⑭ door hardware, ⑮ living-room floor, ⑯ accent storage cloth, ⑰ sash frame |
| `部材対応番号-3.pdf` | ① kitchen counter, ② indirect lighting, ③ gas stove, ④ kitchen panel, ⑤ range hood, ⑥ hanging-shelf hardware, ⑧ kitchen-base tile, ⑪ door hardware (kitchen side) |

For each part, author one record in `public/assets/base/main/parts.json`:

```jsonc
{
  "id": "07",                      // zero-padded; UI renders as ⑦
  "label": "キッチンアクセントクロス",
  "category": "キッチン",          // matches the workbook's leftmost category cell
  "sourcePdf": 1,                  // which 部材対応番号-N.pdf annotates it
  "marker": { "x": 1840, "y": 760 },// numbered-marker centroid in scene-pixel coords
  "polygon": [[1620, 600], …],     // ordered vertices of the colored outline on the PDF
  "renderMode": "color",           // see "Render mode" below
  "mask": "mask_07.png",
  "shading": "shading_07.png"      // required iff renderMode === "color"
}
```

### Polygon tracing

- Trace the colored outline shown on the reference PDF. Points are in **scene-pixel coordinates** of `base.jpg`, not PDF coordinates.
- 8 – 24 vertices is usually enough; precision matters more on edges that touch other parts.
- Use the dev-only tool at `/dev/trace` (added by task 3.6) to overlay a draft polygon on the base perspective and export vertices.

### Render mode

| `renderMode` | Use for | What you author |
| --- | --- | --- |
| `"color"` | flat colorways (paint, paper, fabric, sash frame) | a `mask_<NN>.png` and a `shading_<NN>.png` (luminance map). The runtime composites `shading × colorHex` clipped by the mask. |
| `"texture"` | material/grain swaps (door veneers, kitchen panels, fixture re-renders) | a `mask_<NN>.png` and one `<option-id>.png` per option in `public/assets/finishes/<part-id>/`, **rendered at scene resolution and lighting consistent with `base.jpg`**. The runtime overlays the texture clipped by the mask. |

Suggested defaults (revise as the catalog evolves):

| Part | Mode | Reason |
| ---- | ---- | ---- |
| ① キッチン天板 | texture | marble pattern, not a flat color |
| ② キッチン間接照明 | texture | fixture on/off + warm-light overlay |
| ③ ガスコンロ | texture | discrete fixture variants |
| ④ キッチンパネル | texture | distinct stone-print panels |
| ⑤ レンジフード | texture | fixture geometry / metal finish |
| ⑥ 吊り棚金具 | texture | hardware geometry |
| ⑦ キッチンアクセントクロス | color | flat wallpaper |
| ⑧ キッチン下タイル | texture | tile patterns |
| ⑨ スポットライト | texture | hardware finish + on/off variants |
| ⑩ ドアパネル | texture | wood-grain veneers |
| ⑪ ドア金具 | texture | hardware finish |
| ⑫ 床 (玄関) | color | flat tile colorway (most options) |
| ⑬ パネル ドレタス | texture | wood-grain veneers |
| ⑭ 金具 | texture | hardware finish |
| ⑮ 床 (LDK) | color | flat colorway (per option) |
| ⑯ 収納アクセントクロス | color | flat wallpaper |
| ⑰ サッシ枠 | color | sash paint colorway |

Override per part as needed; the seed script reads `renderMode` from `parts.json` and emits the appropriate option shape.

### Masks

- 8-bit alpha PNG, scene resolution (3000 × 2142 for `main`).
- Alpha = 255 inside the part region, 0 outside.
- Anti-alias the edges (a 1 – 2 px feather) so the composite doesn't show stair-step artifacts.

### Shading (color-mode only)

- 8-bit grayscale PNG, scene resolution.
- Reflect the part region's luminance from the base perspective: brighter where the base is brighter, darker where shadow falls.
- The shading value is multiplied against the chosen `colorHex`, so a uniform mid-gray map gives a flat result; the lighting cues come from the base render.
- Areas outside the part region don't matter (the mask clips them) — keep them mid-gray to avoid surprises if the mask changes.

## Texture-mode finish images

For texture-mode parts, every option in the workbook needs a pre-rendered finish image at scene resolution. Author them so that:

- The lighting matches `base.jpg` (re-render the same scene with the new material, do not slap on a flat texture).
- The image is full scene-size, even though only the masked region is shown — anything outside the mask is clipped and irrelevant.
- File path: `public/assets/finishes/<part-id>/<option-id>.png`.

The seed script (`scripts/extract-finish-options.mjs`) extracts the workbook's embedded swatch images to this same path so designers have a starting point — but the swatch is not the finish image. Replace the seed-emitted file with a scene-resolution render before shipping.

## Color extraction (color-mode only)

The seed script reads each option's swatch image from the workbook and computes a `colorHex` by averaging the central 50% of the swatch. Low-confidence extractions are listed in `public/catalog/finish-options.warnings.json`; override them by editing `resources/catalog/finish-overrides.json`:

```json
{
  "07-sand-beige": { "colorHex": "#D4BFA0" }
}
```

The seed script merges overrides on top of extractions when generating `finish-options.json`.

## Reproducing the runtime layout

```bash
git lfs install                           # one-time, per clone
npm install
npm run seed:parts                        # xlsx → finish-options.json + per-option PNGs
# masks / shading / parts.json are designer-authored, not generated by the script.
npm run dev
```
