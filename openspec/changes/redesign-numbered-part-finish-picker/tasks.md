## 1. Stage source assets and pipeline scaffolding

- [x] 1.1 Create `resources/{base,reference,catalog}/` and copy `ベースパース.jpg`, `部材対応番号-{1,2,3}.pdf`, `部材リスト.xlsx` from the supplied download into them
- [ ] 1.2 Configure Git LFS for the workbook: ensure `git lfs install` is run, add `.gitattributes` line `resources/catalog/*.xlsx filter=lfs diff=lfs merge=lfs -text`, then `git add .gitattributes resources/catalog/部材リスト.xlsx`; confirm `git lfs ls-files` shows it tracked — **PENDING USER**: `git-lfs` not installed on the host (`brew install git-lfs` required); see top-of-PR notes
- [x] 1.2.1 In `scripts/extract-finish-options.mjs`, fail fast with a clear error if the xlsx is detected as an unresolved LFS pointer file (e.g. starts with `version https://git-lfs.github.com/spec/v1`)
- [x] 1.3 Add `xlsx` as a devDependency for the seed script (also `adm-zip` for media extraction)
- [x] 1.4 Write `resources/reference/AUTHORING.md` documenting source perspective dimensions, camera, and authoring guidance for texture-mode finishes

## 2. Base perspective registry

- [x] 2.1 Add Zod schemas for `scenes.json` (registry index) and `scene.json` (per-scene manifest) in `lib/scenes/types.ts`, including the `default: boolean` flag and a `partsManifestUrl` field on each scene
- [x] 2.2 Update `lib/scenes/load.ts` to validate the registry, enforce exactly-one default, and probe the scene's `base.jpg` and `parts.json` at load time with named errors on missing assets
- [x] 2.3 Create `public/assets/base/scenes.json` with one entry `main` marked `default: true`
- [x] 2.4 Copy `resources/base/ベースパース.jpg` to `public/assets/base/main/base.jpg` **at native resolution (no downscale)** (3000×2142) and create `public/assets/base/main/scene.json` with the native pixel dimensions and a reference to `parts.json`
- [x] 2.5 Remove the MVP `ScenePicker` UI (`components/scenes/ScenePicker.tsx`) and any references; the default scene auto-loads on app start

## 3. Numbered-part overlay (parts manifest + masks)

- [x] 3.1 Add `lib/parts/types.ts` with the Zod schema for `parts.json` (id, label, category, sourcePdf, marker, polygon, renderMode, mask, optional shading)
- [x] 3.2 Add `lib/parts/load.ts` that fetches and validates `parts.json` for the active scene and probes every declared `mask`/`shading` file
- [x] 3.3 Trace polygons for parts ① – ⑰ from `部材対応番号-{1,2,3}.pdf` and author `public/assets/base/main/parts.json` — **PLACEHOLDER**: rough rectangular polygons authored from visual reference; designer must refine before shipping (smoke test confirms architecture works end-to-end with these placeholders)
- [x] 3.4 Produce `public/assets/base/main/mask_<NN>.png` for every part — **PLACEHOLDER**: alpha-255 inside polygon, alpha-0 outside, generated via `npm run seed:masks` (`scripts/generate-placeholder-masks.mjs`); designer must hand-paint anti-aliased production masks
- [x] 3.5 Produce `public/assets/base/main/shading_<NN>.png` for every color-mode part — **PLACEHOLDER**: uniform mid-gray (#B4B4B4); designer must generate real luminance maps from the base perspective for shading preservation
- [ ] 3.6 (Designer-tool, optional) Add a dev-only `/dev/trace` page that overlays a draft polygon on the base and exports vertices for `parts.json` — **DEFERRED** to a follow-up; the placeholder polygons unblock the runtime in the meantime

## 4. Finish-spec catalog (xlsx → JSON pipeline)

- [x] 4.1 Add `scripts/extract-finish-options.mjs` that reads both sheets (`アーバンシー`, `レコリード`) of `resources/catalog/部材リスト.xlsx`, walks rows ① – ⑰, and emits per-option records (id, partId, sheet, label, productCode, sheet-row index)
- [x] 4.2 Extend the script to extract embedded swatch images via direct unzip of `xl/media/` cross-referenced with each sheet's `drawing.xml` anchors and write them to `public/assets/finishes/<part-id>/<option-id>.png`
- [x] 4.3 Extend the script to compute `colorHex` for color-mode parts by averaging the central 50% of each option's swatch image
- [x] 4.4 Emit `public/catalog/finish-options.json` (185 options) plus `public/catalog/finish-options.warnings.json` (4 warnings — all from ② which has no swatches in the workbook)
- [x] 4.4.1 For parts where the workbook implies a "no change" / "absent" choice, emit an explicit `none`-equivalent option entry — **MECHANISM PRESENT** in the script (texture-mode → transparent scene-size PNG; color-mode → sentinel #FFFFFF + warning); no labels in the workbook tripped the heuristic for "labels containing 光無し / 無 / なし / unchanged" so no entries were emitted in this run. If real "no change" labels appear, the script will emit them.
- [x] 4.5 Wire `npm run seed:parts` in `package.json` to invoke the script (also `npm run seed:masks` for placeholder masks)
- [x] 4.6 Add `lib/finishes/schema.ts` (Zod) enforcing `colorHex` xor `textureUrl`, unique ids, and known sheet values
- [x] 4.7 Add `lib/finishes/load.ts` that fetches and validates `finish-options.json`, cross-validates `renderMode` against `parts.json`, and exposes `getOptionsForPart(partId, sheet)` and `availableSheets()`
- [x] 4.8 Run the seed once; commit the generated `finish-options.json` and per-option images (185 options, ~39 MB of swatch images under `public/assets/finishes/`)

## 5. Zustand store overhaul

- [x] 5.1 Update `lib/canvas/store.ts` to remove `placedMaterials`, `axisFilters`, and `partColors`
- [x] 5.2 Add `selectedPartId: PartId | null`, `partFinishSelections: Record<PartId, FinishOptionId>`, `activeOptionSheet: SheetName`, and `markersVisible: boolean`
- [x] 5.3 Add store actions: `selectPart`, `clearSelection`, `setFinish(partId, optionId)`, `clearFinish(partId)`, `setActiveSheet(sheet)`, `toggleMarkers`
- [x] 5.4 Implement `setActiveSheet` so it preserves selections by `(partId, label)` and surfaces a notification listing cleared parts (verified via smoke: ⑦ サンドベージュ persisted across アーバンシー → レコリード)
- [x] 5.5 Reject `setFinish` calls for unknown `partId` or render-mode mismatch

## 6. Canvas overlay and finish layers

- [x] 6.1 Replace `components/canvas/MaterialsLayer.tsx` with `components/parts/PartMarkerLayer.tsx` — numbered markers, hover outlines, point-in-polygon hit-testing
- [x] 6.2 Replace `components/canvas/ColorCompositeLayer.tsx` with `components/parts/PartFinishLayer.tsx` supporting both render modes; one Konva Layer per part
- [x] 6.3 Render `PartMarkerLayer` above all `PartFinishLayer` instances; markers render conditional on `markersVisible`
- [x] 6.4 Wire the existing `useImageCache` for the new `mask`, `shading`, and `texture` images
- [x] 6.5 Bind canvas-background click to `clearSelection`; intercept clicks inside any part polygon and route to `selectPart`

## 7. Side panel UI

- [x] 7.1 Add `components/parts/PartList.tsx` (side list) grouped by `category` in workbook order with current-selection summary per row
- [x] 7.2 Add `components/finishes/FinishOptionPanel.tsx` rendering options as clickable chips (swatch + label + productCode) with `clear` button
- [x] 7.3 Add `components/finishes/SheetSwitcher.tsx` bound to `activeOptionSheet` and `availableSheets()`; cleared-parts notification surfaces via `Toast`
- [x] 7.4 Add a top-bar `MarkerToggle` bound to `markersVisible` (default on)
- [x] 7.5 Update `app/page.tsx` to compose the new layout: top bar (sheet switcher, marker toggle, export PNG), left side list, canvas, right finish-options panel

## 8. Removals (per design D9)

- [x] 8.1 Delete `components/catalog/CatalogPanel.tsx` and any imports (git rm)
- [x] 8.2 Delete `components/canvas/MaterialsLayer.tsx` and any imports (git rm)
- [x] 8.3 Delete `lib/catalog/{schema,filter,load}.ts` and `public/catalog/materials.json` (git rm)
- [x] 8.4 Delete `public/assets/materials/` and `scripts/generate-seed-assets.mjs` (git rm); also removed the MVP-era `public/assets/base/living-room-01/` seed scene
- [x] 8.5 Remove material-instance handling (selection, drag, Delete-key bindings) — gone with the rewrite of `CanvasStage.client.tsx`

## 9. Project export

- [x] 9.1 `project-export` produces a PNG of the new composition; filename pattern uses the registered scene id (`specdrawing-main-<timestamp>.png`); `pixelRatio` is `1 / displayScale` so the exported PNG is at native scene resolution despite the on-screen downscale
- [x] 9.2 Markers hidden during export by setting `markersVisible=false` for the duration of `toDataURL`, restored after

## 10. Validation, smoke test, and docs

- [x] 10.1 `npm run typecheck` and `npm run lint` pass
- [x] 10.2 `openspec validate redesign-numbered-part-finish-picker` continues to pass after task implementation
- [x] 10.3 Manual smoke (in Playwright headless): app start → default perspective auto-loaded → ⑦ click → サンドベージュ pick → wall accent tinted (placeholder shading is uniform so no shading variation visible — needs designer shading map) → ⑩ click → ｺｺﾅｯﾂﾁｪﾘｰ pick → door panel texture overlays mask region → sheet switch to レコリード → ⑦ サンドベージュ preserved by label match → export PNG downloaded as `specdrawing-main-20260427142514.png`
- [x] 10.4 Update `README.md`: replace the "Asset conventions" and "Smoke test" sections with the new parts/finish-options model; document `npm run seed:parts` and `npm run seed:masks`
- [x] 10.5 Archive the prior `add-material-presenter-mvp` change first — done (`openspec/changes/archive/2026-04-27-add-material-presenter-mvp/`); this change archives after merge

## 11. Designer follow-ups (out of MVP scope, tracked here for handoff)

- [ ] 11.1 Replace placeholder polygons in `public/assets/base/main/parts.json` with traced outlines from `部材対応番号-{1,2,3}.pdf`
- [ ] 11.2 Replace placeholder masks under `public/assets/base/main/mask_<NN>.png` with hand-painted, anti-aliased production masks
- [ ] 11.3 Replace placeholder shading maps under `public/assets/base/main/shading_<NN>.png` with real luminance maps derived from the base perspective for color-mode parts
- [ ] 11.4 Replace per-option swatch PNGs under `public/assets/finishes/<part-id>/` with scene-resolution finish renders for texture-mode parts (per `resources/reference/AUTHORING.md`)
- [ ] 11.5 Optionally implement the `/dev/trace` designer tool from task 3.6
- [ ] 11.6 Optionally downsample the per-option swatches in the seed script to reduce `public/` size (currently ~39 MB; ⑤ レンジフード alone is 21 MB of full-resolution photos)
