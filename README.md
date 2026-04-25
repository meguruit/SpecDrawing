# SpecDrawing — Material Presenter (MVP)

Interactive presentation board: pick a base perspective image, drop building
materials onto it from a multi-axis catalog, optionally recolor parts of the
base image (wall, floor, …) with arbitrary HEX colors using a mask + shading
composition pipeline, and export the result as a PNG.

This is the MVP. See [`openspec/changes/add-material-presenter-mvp/proposal.md`](openspec/changes/add-material-presenter-mvp/proposal.md)
for the change record and explicit non-goals.

## Run it

```bash
npm install
npm run seed:assets   # generate placeholder base scene + material thumbnails
npm run dev           # http://localhost:3000
```

Other scripts:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # next lint
npm run build         # production build
```

> **Package manager note.** The original task list referenced `pnpm`. This
> repo currently does not have pnpm installed; every script works identically
> with `npm run`. Switch to pnpm later by running `volta install pnpm` and
> using `pnpm <script>` in place of `npm run <script>`.

## Tech stack

- **Next.js 14** (App Router, TypeScript) — single-tier app, no separate backend
  (see `design.md` D10 for the rationale).
- **React 18** + **Tailwind CSS**.
- **Konva 9** + **react-konva** for the canvas. Loaded only on the client via
  `next/dynamic({ ssr: false })`.
- **Zustand** for canvas state.
- **Zod** for catalog and scene-manifest validation.
- **sharp** (devDep) for the seed-asset generator script.

## Asset conventions

### Scenes

```
public/assets/base/
  scenes.json                      # index of available scenes
  <scene-id>/
    scene.json                     # manifest: id, dimensions, parts list
    base.jpg                       # bottom-layer perspective image
    mask_<part>.png                # alpha mask for each color-mutable part
    shading_<part>.png             # grayscale luminance map for each part
```

`scene.json` declares which `parts` exist for that scene. The loader probes
each declared part's mask and shading file at scene-load time and throws a
loud, named error if any required asset is missing.

The MVP ships one seed scene at `living-room-01` with two parts: `wall` and
`floor`. The scene assets are produced from a procedural script
(`scripts/generate-seed-assets.mjs`) — run `npm run seed:assets` to
regenerate.

### Materials catalog

```
public/catalog/materials.json      # the catalog (Zod-validated at load)
public/assets/materials/<id>/
  thumb.png                        # catalog grid thumbnail
  placement.png                    # image drawn on canvas when placed
```

Each entry has an `axes` map. Known axis keys (`series`, `design`, `color`,
`width`, `height`, `openingType`, `mirror`, `type`) get their own filter
group; any unknown axis (e.g. `finish`) is permitted and surfaces under the
"その他の軸" (other axes) group.

## Color composition pipeline

For each scene part with an active color override, the canvas renders a
**dedicated Konva `Layer`** containing the following draw order:

1. `shading_<part>.png` at full scene size — destination becomes the grayscale
   shading map.
2. A solid color `Rect` at full scene size with `globalCompositeOperation="multiply"`
   — destination becomes (shading × color) RGB everywhere.
3. `mask_<part>.png` at full scene size with `globalCompositeOperation="destination-in"`
   — clips the (shading × color) result to the mask alpha; everything else
   becomes fully transparent.

Two invariants kept this from going sideways during the build:

- **Mask is applied last.** If the multiply runs after the mask, Canvas2D's
  `multiply` against alpha-0 destination paints opaque source pixels — the
  shading image bleeds onto unmasked regions as gray smears.
- **One Layer per part.** Putting two parts as groups on a single shared Layer
  fails because each part's first draw step (the full-scene shading image)
  overwrites the previous part's already-masked content.

CSS `filter: hue-rotate` is **not** used and would be incorrect here — it
shifts hue without preserving luminance/saturation fidelity.

## Project structure

```
app/                  Next.js App Router pages
  layout.tsx
  page.tsx            top-level UI shell (server component shell, client islands)
  globals.css         Tailwind base
components/
  Toast.tsx
  catalog/
    CatalogPanel.tsx  axis filters + thumbnail grid
  canvas/
    CanvasStage.client.tsx     Konva Stage (the only ssr:false boundary)
    ColorCompositeLayer.tsx    one Layer per overridden part
    MaterialsLayer.tsx         placed materials, drag/select
  color/
    PartColorPicker.tsx        per-part HEX color input
  scenes/
    ScenePicker.tsx            scene index + load action
lib/
  canvas/
    store.ts          Zustand store
    useImageCache.ts  HTMLImageElement cache for Konva
  catalog/
    schema.ts         Zod schemas
    load.ts           fetch + validate
    filter.ts         pure filtering by axis selections
  scenes/
    types.ts          scene + scenes-index Zod schemas
    load.ts           fetch + asset probing
public/               static assets (catalog + scenes)
scripts/
  generate-seed-assets.mjs     procedural seed image generator
openspec/             OpenSpec change records
```

## What's deferred (not in this MVP)

Listed in the change proposal's non-goals — repeated here for visibility:

- No frontend/backend separation (single Next.js app; see design.md D10).
- No server-side persistence, auth, or multi-user support.
- No server-side high-resolution PDF / 2840×2000 print rendering.
- No rich editor affordances (text, shapes, lines, undo/redo, align, rotate,
  copy/paste, zoom, layer order).
- No CMS / admin UI for catalog management.
- No real catalog ingestion — the seed catalog has 6 procedural entries.
- No mobile/touch-optimized layout.

## Smoke test

After `npm run dev`:

1. Click "リビング #1 (seed)" in the left panel — base scene loads on canvas.
2. Pick any axis filter (e.g. `series = "K"`) — catalog grid narrows.
3. Click two thumbnails — two material instances appear on canvas, second is
   selected (blue outline).
4. Drag the selected material — position updates.
5. Press Delete — selected material is removed.
6. In the right panel under "色の上書き", set a wall color and a floor color —
   each region recolors with shading preserved; the window stays untouched.
7. Click "クリア" on the wall — wall reverts to its base image.
8. Click "Export PNG" in the top bar — a file
   `specdrawing-living-room-01-<timestamp>.png` downloads at 2048×1536
   (pixelRatio 2 of the 1024×768 stage).
