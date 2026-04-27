# SpecDrawing — Numbered-Part Finish Picker

Interactive presentation board for a registered base perspective image. The
user selects a numbered part on the perspective (① – ⑰, annotated on the
supplied `部材対応番号-{1,2,3}.pdf` reference PDFs), picks one of that part's
finish options sourced from `部材リスト.xlsx`, and the perspective updates
immediately to reflect the choice. Supports two render modes per part:

- **color** — flat colorways (paint, wallpaper, sash frame) composited as
  `mask × shading × color`.
- **texture** — material/grain swaps (door veneers, kitchen panels) overlayed
  as a pre-rendered texture image clipped by the part's mask.

Export the result as a PNG at native scene resolution.

This is the redesign that supersedes the original MVP (free-drop catalog).
See [`openspec/changes/redesign-numbered-part-finish-picker/proposal.md`](openspec/changes/redesign-numbered-part-finish-picker/proposal.md)
for the change record and explicit non-goals, and the archived
[`openspec/changes/archive/2026-04-27-add-material-presenter-mvp/`](openspec/changes/archive/2026-04-27-add-material-presenter-mvp/)
for the prior model.

## Run it

```bash
git lfs install                  # one-time per clone (the workbook is in LFS)
npm install
npm run seed:masks               # generate placeholder mask + shading PNGs
npm run seed:parts               # extract finish options from the workbook
npm run dev                      # http://localhost:3000
```

Other scripts:

```bash
npm run typecheck                # tsc --noEmit
npm run lint                     # next lint
npm run build                    # production build
```

## Tech stack

- **Next.js 14** (App Router, TypeScript) — single-tier app, no separate
  backend (see the change's `design.md` D10 for the rationale).
- **React 18** + **Tailwind CSS**.
- **Konva 9** + **react-konva** for the canvas. Loaded only on the client via
  `next/dynamic({ ssr: false })`.
- **Zustand** for canvas state.
- **Zod** for scene-manifest, parts-manifest, and finish-options validation.
- **sharp**, **xlsx**, **adm-zip** (devDeps) for the seed scripts.

## Asset conventions

```
resources/                                designer source-of-truth (commit, do not serve)
  base/main/ベースパース.jpg                raw perspective JPG (3000×2142, native res)
  reference/部材対応番号-{1,2,3}.pdf         annotated reference PDFs
  reference/AUTHORING.md                  designer guide for parts & finishes
  catalog/部材リスト.xlsx                   option workbook (Git LFS)

public/                                   runtime, served by Next.js
  assets/base/scenes.json                 registry index (one entry "main", default)
  assets/base/main/scene.json             id, name, dimensions, partsManifestUrl
  assets/base/main/base.jpg               native-resolution copy of the source perspective
  assets/base/main/parts.json             numbered-part manifest (① – ⑰)
  assets/base/main/mask_<NN>.png          alpha mask per part
  assets/base/main/shading_<NN>.png       luminance map per color-mode part
  assets/finishes/<part-id>/<option-id>.png   per-option swatch / texture
  catalog/finish-options.json             generated from the workbook
  catalog/finish-options.warnings.json    color-extraction / missing-swatch warnings
```

The `parts.json` manifest declares for each part: id, label, category,
sourcePdf reference, marker centroid, polygon (for hit-testing), `renderMode`,
and the mask / shading filenames. The loader probes every declared mask and
shading file at scene-load time and throws a named error on missing assets.

The `finish-options.json` catalog is derived from `部材リスト.xlsx` by
`scripts/extract-finish-options.mjs`. Each option entry sets exactly one of
`colorHex` (color-mode parts) or `textureUrl` (texture-mode parts), and the
loader cross-validates the shape against the part's `renderMode`.

> **Placeholder warning.** The shipped `parts.json`, `mask_<NN>.png`, and
> `shading_<NN>.png` are placeholders authored to make the architecture run
> end-to-end (rough rectangular polygons, alpha-only masks, uniform-gray
> shading). A designer must replace them with traced polygons, anti-aliased
> production masks, and real luminance maps before shipping. Per-option
> texture renders for texture-mode parts also need designer authoring (the
> seed currently re-uses workbook swatches as placeholders). See
> [`resources/reference/AUTHORING.md`](resources/reference/AUTHORING.md).

## Color composition pipeline

For each part with an active finish selection, the canvas renders a
**dedicated Konva `Layer`** whose draw order depends on the part's
`renderMode`:

**color** mode:

1. `shading_<NN>.png` at full scene size (no compositing operator).
2. Solid color `Rect` at full scene size with
   `globalCompositeOperation="multiply"`.
3. `mask_<NN>.png` at full scene size with
   `globalCompositeOperation="destination-in"`.

**texture** mode:

1. The option's texture image at full scene size (no compositing operator).
2. `mask_<NN>.png` at full scene size with
   `globalCompositeOperation="destination-in"`.

Two invariants:

- **Mask is applied last.** If the multiply runs after the mask, Canvas2D's
  `multiply` against alpha-0 destination paints opaque source pixels — the
  shading image bleeds onto unmasked regions as gray smears.
- **One Layer per part.** Putting two parts as groups on a single shared
  Layer fails because each part's first draw step (the full-scene shading or
  texture image) overwrites the previous part's already-masked content.

CSS `filter: hue-rotate` is **not** used and would be incorrect here — it
shifts hue without preserving luminance / saturation fidelity.

## Project structure

```
app/
  layout.tsx
  page.tsx                              top-level UI shell
  globals.css                           Tailwind base
components/
  Toast.tsx
  canvas/
    CanvasStage.client.tsx              Konva Stage (the only ssr:false boundary)
  parts/
    PartMarkerLayer.tsx                 numbered markers + hover outlines + hit-testing
    PartFinishLayer.tsx                 one Layer per active part finish (color / texture)
    PartList.tsx                        grouped side list of parts with selection summary
  finishes/
    FinishOptionPanel.tsx               option chips for the selected part on the active sheet
    SheetSwitcher.tsx                   workbook sheet switcher
    MarkerToggle.tsx                    show/hide numbered markers on canvas
lib/
  canvas/
    store.ts                            Zustand store (selectedPartId, partFinishSelections, …)
    useImageCache.ts                    HTMLImageElement cache for Konva
  scenes/
    types.ts                            scene + registry Zod schemas
    load.ts                             registry index + per-scene loader with asset probes
  parts/
    types.ts                            parts.json Zod schema
    load.ts                             parts loader + asset probing + url resolution
  finishes/
    schema.ts                           finish-options.json Zod schema
    load.ts                             finishes loader + cross-validation against parts
public/                                 static runtime assets (see "Asset conventions")
resources/                              designer source-of-truth (see "Asset conventions")
scripts/
  generate-placeholder-masks.mjs        npm run seed:masks
  extract-finish-options.mjs            npm run seed:parts
openspec/                               OpenSpec change records
```

## What's deferred (not in this change)

- No frontend/backend separation (single Next.js app).
- No server-side persistence, auth, or multi-user support.
- No server-side high-resolution PDF rendering.
- No rich editor affordances (text, shapes, lines, undo/redo, …).
- No CMS / admin UI.
- No multi-perspective gallery (registry supports it; only `main` ships).
- No `/dev/trace` designer tool yet (deferred follow-up).

## Smoke test

After `npm run dev`:

1. App opens at <http://localhost:3000> and the default perspective
   auto-loads with all 17 numbered markers visible.
2. Click marker ⑦ (or "キッチンアクセントクロス" in the left list) — the
   right panel shows option chips for アーバンシー sheet.
3. Pick "サンドベージュ" — the kitchen accent area tints sand-beige.
4. Click marker ⑩ — pick "ｺｺﾅｯﾂﾁｪﾘｰ" — the entry door area swaps to the
   wood-grain texture.
5. Switch the sheet to "レコリード" — ⑦ サンドベージュ is preserved
   (label match across sheets); selections that don't match get cleared with
   a toast notification.
6. Toggle "番号オーバーレイ" off — markers and outlines hide; selections
   stay applied.
7. Click "Export PNG" — a file `specdrawing-main-<timestamp>.png` downloads
   at native scene resolution (3000×2142). Markers are hidden in the export.
