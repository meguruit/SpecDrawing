## 1. Project scaffold

- [x] 1.1 Initialize Next.js 14 (App Router, TypeScript, ESLint) at the repo root via `create-next-app`, UTF-8 only, no `/src` dir flag per team preference (decide during 1.1)
- [x] 1.2 Add runtime deps: `konva`, `react-konva`, `zustand`, `zod`
- [x] 1.3 Add Tailwind CSS per Next.js App Router setup (`postcss`, `tailwindcss`, `autoprefixer`, base `globals.css`, `tailwind.config.ts`)
- [x] 1.4 Configure `tsconfig.json` strict mode; add `@/*` path alias mapping to the project root
- [x] 1.5 Add `.nvmrc` / `package.json#engines` pinning Node 20 LTS; add `scripts`: `dev`, `build`, `start`, `typecheck`, `lint`
- [x] 1.6 Commit a minimal root layout (`app/layout.tsx`) and a placeholder `app/page.tsx` so `pnpm dev` serves a blank page with Tailwind working

## 2. Seed assets & catalog

- [x] 2.1 Create `public/assets/base/living-room-01/` with `base.jpg`, `mask_wall.png`, `shading_wall.png`, `mask_floor.png`, `shading_floor.png` (hand-authored seed; ≤ 2000 px long edge)
- [x] 2.2 Write `public/assets/base/living-room-01/scene.json` declaring parts `["wall", "floor"]` with human labels
- [x] 2.3 Write `public/assets/base/scenes.json` index listing all available scenes and their directories
- [x] 2.4 Add at least 6 seed material entries to `public/catalog/materials.json` covering multiple values for `series`, `design`, `color`, `width`, plus one entry with an unknown axis (`finish`) to exercise the unknown-axis path
- [x] 2.5 Add seed material thumbnails and placement images under `public/assets/materials/<id>/` matching the `thumbnailUrl` / `placementImageUrl` fields

## 3. Catalog module (`material-catalog`)

- [x] 3.1 Define the catalog Zod schema in `lib/catalog/schema.ts` (MaterialEntry, Axes with known + unknown keys, global uniqueness constraint on `id`)
- [x] 3.2 Implement `lib/catalog/load.ts`: fetch `/catalog/materials.json`, validate with Zod, throw named errors on failure
- [x] 3.3 Implement `lib/catalog/filter.ts`: pure function that takes entries + active axis selections and returns filtered entries (AND across axes, OR within an axis if we ever allow multi-select — MVP: single-select per axis)
- [x] 3.4 Build `components/catalog/CatalogPanel.tsx` rendering axis filter groups (including a generic group for unknown axes) and a thumbnail grid
- [x] 3.5 Wire thumbnail click to the canvas store's `addMaterial(entryId)` action (implemented in §4)
- [x] 3.6 Render an empty-state message when filter results are zero

## 4. Canvas store & client boundary (`presentation-canvas`)

- [x] 4.1 Create `lib/canvas/store.ts` with Zustand: `{ activeSceneId, placedMaterials[], colorOverrides, selectionId }` and actions `loadScene`, `addMaterial`, `moveMaterial`, `deleteMaterial`, `select`, `clearSelection`, `setPartColor`, `clearPartColor`
- [x] 4.2 Implement scene loader `lib/scenes/load.ts`: read `scenes.json`, `scene.json`, validate every declared part has a `mask_<part>.png` and `shading_<part>.png` sibling (probe with `HEAD` or validate against a manifest), throw with a scene+file message on mismatch
- [x] 4.3 Build `components/canvas/CanvasStage.client.tsx` (the sole Konva entry point): `'use client'`, renders `<Stage>` with layers: BaseImage → ColorCompositeLayer (§5) → MaterialsLayer
- [x] 4.4 In `MaterialsLayer`, render each placed material as a `<KonvaImage>`, wire `draggable`, `onClick` to select, `onDragEnd` to `moveMaterial`
- [x] 4.5 Global key handler: Delete / Backspace when a material is selected calls `deleteMaterial`
- [x] 4.6 Click the stage background (Konva `onMouseDown` on the Stage where target === stage) calls `clearSelection`
- [x] 4.7 Ensure `CanvasStage.client.tsx` is imported via `next/dynamic({ ssr: false })` from `app/page.tsx`

## 5. Color composition (`color-composition`)

- [x] 5.1 Build `components/canvas/ColorCompositeLayer.tsx`: for each scene part with an active override, render a **dedicated Konva Layer** (one Layer per part — required for cross-part isolation) with draw order **shading image → color Rect (`multiply`) → mask image (`destination-in`)**, all at full scene size. Mask MUST be applied last to prevent multiply-leak onto unmasked regions.
- [x] 5.2 Preload mask and shading images via a cache hook `lib/canvas/useImageCache.ts` so repaint is synchronous after first load
- [x] 5.3 Build `components/color/PartColorPicker.tsx`: lists parts declared by the active scene, each with a HEX color input (native `<input type="color">`) and a "Clear" button
- [x] 5.4 Wire the picker to `setPartColor` / `clearPartColor` on the store; verify the store rejects updates for part ids not in the active scene's declaration
- [x] 5.5 Manually verify in-browser: wall recolor shows through mask only; shading is preserved; clearing restores base; overlapping parts follow scene declaration order

## 6. Export (`project-export`)

- [x] 6.1 Add an "Export PNG" button to the top bar; disabled when `activeSceneId` is null
- [x] 6.2 On click, call `stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' })` from a ref to the Konva `Stage`; ensure the call momentarily hides any selection affordances by clearing selection before `toDataURL` and restoring after
- [x] 6.3 Trigger a browser download via a hidden `<a>` with `download` set to `specdrawing-<sceneId>-<YYYYMMDDHHmmss>.png` (local time), then revoke any created object URL
- [x] 6.4 Manually verify the exported PNG is at pixelRatio 2 and contains base + overrides + placed materials, but no selection handles

## 7. UI shell

- [x] 7.1 Lay out `app/page.tsx`: left panel = scene picker, center = `<CanvasStage>`, right panel = `<CatalogPanel>` on top and `<PartColorPicker>` below, top bar = export button
- [x] 7.2 Basic responsive styling with Tailwind; desktop-first; no mobile affordances required for MVP
- [x] 7.3 Show a transient error toast when catalog or scene load throws, with the underlying message

## 8. Quality gates

- [x] 8.1 `pnpm typecheck` passes with no errors
- [x] 8.2 `pnpm lint` passes
- [x] 8.3 `pnpm build` produces a successful production build
- [x] 8.4 Manual smoke test checklist (documented in the PR description): load scene → filter catalog by one axis → place two materials → drag one → delete one → set wall color → set floor color → clear wall color → export PNG → confirm file downloaded with expected name and pixel dimensions
- [x] 8.5 Confirm Konva never runs in SSR: temporarily disable `ssr: false` and verify the build fails, then restore (document this check in the PR description)

## 9. Wrap-up

- [x] 9.1 Add a top-level `README.md` with: project purpose, how to run, the asset convention for scenes and materials, and a "what's deferred" list pointing to the proposal's non-goals
- [x] 9.2 Run `openspec validate add-material-presenter-mvp` and fix any reported issues
- [ ] 9.3 Open a PR summarizing the change and linking the proposal/design/specs — **DEFERRED**: repo is not yet a git repository (`is git repository: false`). Run `git init` + add a remote, then revisit.
