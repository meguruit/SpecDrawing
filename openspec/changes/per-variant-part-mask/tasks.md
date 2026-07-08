## 1. Schema & types

- [x] 1.1 Add `maskByVariant?: Record<string, string>` and `maskPolygonsByVariant?: Record<string, Polygon[]>` to `partSchema` in `lib/parts/types.ts` (variant key = non-empty string, filename = non-empty string, polygons reuse `polygonSchema`)
- [x] 1.2 Carry both fields through `RawPart` → `Part` and `normalizePart` (preserved verbatim via `...rest` / `Omit`; per-variant polygons are not pushed through the legacy `polygon` path)
- [x] 1.3 Verify schema rules (no test runner in repo — covered by `tsc --noEmit` + the Zod `.min(1)` / `polygonSchema` refinements; valid per-variant manifest parses, empty key/filename and <3-vertex rings rejected by construction)

## 2. Loader: validation, probe, cache-bust

- [x] 2.1 In `lib/parts/load.ts`, extend the asset probe to HEAD-check every `maskByVariant[key]` file under the scene dir; error names scene, part id, variant key (`mask[<key>]`), and missing file
- [x] 2.2 Add a cross-scene check that every `maskByVariant` / `maskPolygonsByVariant` key exists in the scene's `scene.json` `variants`; error names part id + unknown key
- [x] 2.3 Fold `maskByVariant` + `maskPolygonsByVariant` (stringified) into `partRevision()` so `_rev` changes when per-variant data changes
- [x] 2.4 Verify loader behavior (no test runner — confirmed by code path: probe loop covers per-variant files, cross-check throws on unknown key, `partRevision` payload now includes the variant fields so `_rev` differs)

## 3. Runtime rendering (PartFinishLayer)

- [x] 3.1 In `components/parts/PartFinishLayer.tsx`, resolve the mask filename as `part.maskByVariant?.[activeVariantKey] ?? part.mask` before `resolveAssetUrl` + `bust`
- [x] 3.2 Confirm fallback paths: no active variant, or active variant without an entry, both use base `mask`; composite ordering (mask `destination-in` last) unchanged for color and texture modes
- [x] 3.3 Switching variant requests the variant's mask URL — the resolved filename differs per variant, so the `useImageCache` Map (keyed by URL) cannot serve the prior variant's mask

## 4. Regen pipeline

- [x] 4.1 In `lib/dev/regenAssets.ts`, factored `writeMaskFile(polygons, dir, filename, …)`; `writeMaskPng` writes the base `mask` from `polygons` then loops `maskPolygonsByVariant`, rasterizing each to its `maskByVariant[key]` path (derived name fallback); base mask byte-identical for parts with no per-variant data
- [x] 4.2 In `app/api/dev/parts/regen/route.ts`, `partRegenKey` now includes `maskByVariant` + `maskPolygonsByVariant`, so a per-variant change marks the part stale
- [x] 4.3 `?force=true` regenerates base + all per-variant masks for every part (force path runs the same `writeMaskPng` that now emits variants)
- [x] 4.4 Regen sidecar hash writer uses the new hash formula (base + variant fields); unchanged parts' entries preserved; atomic `.tmp`+rename unchanged
- [ ] 4.5 Runtime QA (needs `npm run dev`): edit one variant's polygons, confirm regen rewrites both base mask and the variant mask with newer mtime, and only that part is regenerated

## 5. /dev/trace authoring UI

- [x] 5.1 Added a "マスク層" selector to the `/dev/trace` header (base/default + each scene variant, with ●/○ override indicator); shown only when the scene has variants
- [x] 5.2 Selecting a variant swaps the displayed base image to that variant's `baseImageUrl` (`editBaseUrl` memo drives `useImage`)
- [x] 5.3 Editing target routing: base edits shared `polygons`; a variant edits `maskPolygonsByVariant[key]` via `editingPart` view + variant-aware `updatePart`, seeded from shared `polygons` on first touch and persisted under that key (+ derived `maskByVariant[key]`)
- [x] 5.4 Variant editing never mutates `marker` or shared `polygons`: `updatePart`'s variant branch writes only the variant slot; marker is non-draggable + dimmed and `handleMoveMarkerLive` bails under a variant
- [x] 5.5 Side panel shows the active variant layer and a "このバリアントを削除" button (`handleRemoveVariantOverride` drops `maskPolygonsByVariant[key]` + `maskByVariant[key]`); undo/redo is variant-aware via `HistoryEntry.editVariant`
- [x] 5.6 Autosave PUT persists the new fields (in `partsManifestSchema`, serialized by the route); debounced regen fires via the existing `scheduleRegen` in the save flush

## 6. Verification & docs

- [ ] 6.1 Runtime QA (needs `npm run dev`): author a per-variant mask on one real part end-to-end via `/dev/trace`; confirm each variant renders its own masked region on `/`
- [x] 6.2 Part with no per-variant data is byte-identical by construction — `writeMaskPng`'s base path is the unchanged `writeMaskFile(part.polygons, …, part.mask, …)` and the variant loop is empty; `_rev`/regen hash only gain `…?? null`, so no churn for existing parts
- [x] 6.3 `tsc --noEmit`, `next lint`, and `next build` all pass (repo has no test suite)
- [x] 6.4 Documented the per-variant mask fields + the click-vs-fill scope trade-off in `README.md`

## 7. Per-option mask override (finish-options.json)

- [x] 7.1 Add a single optional `mask: z.string().min(1)` to `finishOptionSchema` in `lib/finishes/schema.ts` (optional, independent of the `colorHex`/`textureUrl` xor; no per-option geometry field)
- [x] 7.2 In `components/parts/PartFinishLayer.tsx`, resolve the mask as `option.mask ?? (activeVariantKey && part.maskByVariant?.[activeVariantKey]) ?? part.mask`; when the value came from `option.mask`, use it as a full web-root path (skip `resolveAssetUrl`) and cache-bust with the catalog `optionsRev`; otherwise keep the existing `resolveAssetUrl(scene, …)` + part `_rev` path
- [x] 7.3 Confirm precedence + fallback: an option without `mask` behaves exactly as today (per-variant → base); an option `mask` overrides on every variant, including no-active-variant; applies to both `renderMode: "color"` and `"texture"` (verified by code path: `maskUrl` is computed before the color/texture branch and `option.mask` short-circuits without consulting `activeVariantKey`)
- [x] 7.4 Verify `tsc --noEmit`, `next lint`, `next build` (all pass)
- [x] 7.5 Deferred (out of scope this round, tracked for a follow-up): regen of per-option mask PNGs, `/dev/trace` authoring of option-level masks, load-time probe of `option.mask`

## 8. Per-option mask disable (`mask: "no"` sentinel)

- [x] 8.1 Document the reserved `"no"` sentinel on `finishOptionSchema.mask` in `lib/finishes/schema.ts` (type stays `z.string().min(1)`; `"no"` disables mask compositing in texture mode, ignored in color mode)
- [x] 8.2 In `components/parts/PartFinishLayer.tsx`, resolve `maskUrl` to `null` when `option.mask === "no"` and `part.renderMode === "texture"`; in color mode (or any other value) fall through to the existing path resolution. Widen `maskUrl` to `string | null`
- [x] 8.3 In `PartFinish`, treat `maskUrl === null` as "no mask": don't require the mask image (`if (!noMask && !mask) return null`) and omit the trailing `destination-in` `KonvaImage` in the texture branch; color branch unchanged (never receives a null mask)
- [x] 8.4 Confirm precedence + scope: `"no"` outranks `option.mask`-path / `maskByVariant` / base mask on every variant for texture parts; color-mode options ignore `"no"` and resolve the part mask normally (verified by code path: the `"no"` check short-circuits before any path resolution and only when `renderMode === "texture"`)
- [ ] 8.5 Runtime QA (needs `npm run dev`): set `mask: "no"` on a texture option and confirm the texture PNG renders unclipped across all variants; confirm a color option with `mask: "no"` still clips to the part region
- [x] 8.6 Verify `tsc --noEmit`, `next lint`, `next build`

## 9. Per-part default selection (`default-options.json`, per-sheet)

- [x] 9.1 Add `defaultOptionsFileSchema` to `lib/finishes/schema.ts` (sheet-first): `{ version: z.literal(1), sheet: z.array({ id: sheetNameSchema, parts: z.array({ id: /^\d{2}$/, default: z.string().min(1) }) }) }`; export `DefaultOptionsFile` type and the resolved `PartSheetDefaults = Record<PartId, Record<SheetName, FinishOptionId>>`
- [x] 9.2 Add `loadDefaultOptions(url = "/catalog/default-options.json")` to `lib/finishes/load.ts`: fetch with `cache: "no-store"`; 404 → `{}` (optional, back-compat); parse + Zod-validate (error names failing entry/field); reject duplicate `(sheet.id, part.id)` pairs; flatten the sheet-first file to `PartSheetDefaults`
- [x] 9.3 Add `crossValidateDefaultOptionsAgainstCatalog(defaults, options, parts)` to `lib/finishes/load.ts`: for every `(partId, sheet) → optionId`, assert the option exists, its `partId` matches, its `sheet` matches the map key, and its `colorHex`/`textureUrl` shape matches the part's `renderMode`; throw `FinishesLoadError` naming part id + sheet + option id on the first mismatch
- [x] 9.4 In `app/page.tsx`, call `loadDefaultOptions()`, run `crossValidateDefaultOptionsAgainstCatalog(...)` alongside the other cross-validators, and pass the resolved map into `loadSceneAction`
- [x] 9.5 In `lib/canvas/store.ts`, add `partSheetDefaults: PartSheetDefaults`; extend `loadScene` signature to accept it and seed `partFinishSelections[partId] = defaults[partId][defaultSheet]` for each part with a default for the initial sheet (others stay unselected)
- [x] 9.6 In `setActiveSheet`, replace the preserve-or-clear loop with the explicit-vs-default classification (D8): explicit pick (`sel && sel !== oldDefault`) → label-match else new-sheet default else clear+notify; at-default/untouched → new-sheet default else unselected. Only explicit selections lost with no default fallback go into the `cleared` notification
- [x] 9.7 In `components/finishes/FinishOptionPanel.tsx`, resolve `defaultId = partSheetDefaults[part.id]?.[sheet]`; render クリア only when `currentId && currentId !== defaultId`; on click `defaultId ? setFinish(part.id, defaultId) : clearFinish(part.id)`
- [x] 9.8 Add a starter `public/catalog/default-options.json` (e.g. part `03` per the example, with both アーバンシー / レコリード defaults) and document the file shape + per-sheet semantics in `README.md`
- [x] 9.9 Verify `tsc --noEmit`, `next lint`, `next build`
- [ ] 9.10 Runtime QA (needs `npm run dev`): a defaulted part opens pre-selected with no クリア button; picking a non-default reveals クリア; クリア returns to the default; switching brand keeps a defaulted/untouched part at the new brand's default while preserving an explicit non-default pick by label; an undefined part still starts 未選択 and クリア removes its selection

## 10. Per-base default refinement (`default-options.json` base overrides)

- [x] 10.1 In `lib/finishes/schema.ts`, change the `defaultOptionsFileSchema` part entry to `z.object({ id: /^\d{2}$/, default: z.string().min(1) }).catchall(z.string().min(1))` so each entry may carry extra base-keyed option ids; change `PartSheetDefaults` value type to `{ default: FinishOptionId; byBase: Record<string, FinishOptionId> }`; export a `resolveSheetDefault(entry, activeBase)` helper (`entry ? (activeBase && entry.byBase[activeBase]) ?? entry.default : undefined`)
- [x] 10.2 In `lib/finishes/load.ts` `loadDefaultOptions`, separate `default` from the catchall base keys when flattening, building `{ default, byBase }` per `(part, sheet)`; duplicate `(sheet, part)` check unchanged
- [x] 10.3 In `crossValidateDefaultOptionsAgainstCatalog`, validate `default` **and every base override** (existence, partId, sheet, renderMode); error message names the base key when the offender is a base override
- [x] 10.4 In `lib/canvas/store.ts`: seed in `loadScene` via `resolveSheetDefault(defaults[part.id]?.[defaultSheet], variantKey)`; in `setActiveSheet` resolve `oldDefault`/`newDefault` via `resolveSheetDefault(…, activeVariantKey)` / `(…, newVariantKey)` (compute the new base first); in `setActiveVariantKey` re-seed at-default/untouched parts to the new base's effective default (explicit picks preserved, no notification)
- [x] 10.5 In `components/finishes/FinishOptionPanel.tsx`, read `activeVariantKey` and compute `defaultId = resolveSheetDefault(partSheetDefaults[part.id]?.[sheet], activeVariantKey)`
- [x] 10.6 Update the starter `public/catalog/default-options.json` (part `14` with a `sharp` base override) and document the per-base shape + `byBase ?? default` resolution in `README.md`
- [x] 10.7 Verify `tsc --noEmit`, `next lint`, `next build`
- [ ] 10.8 Runtime QA (needs `npm run dev`): a part with a `sharp` base override opens on its base override when `sharp` is active and on `default` otherwise; switching base re-seeds at-default parts and preserves explicit picks; back-compat — an entry with no base keys behaves as before

## 11. Export 選択状態 reflects default definition

- [x] 11.1 In `lib/export/spec-sheet.ts`, add an optional `partSheetDefaults?: PartSheetDefaults` arg to `buildSpecSheetRows` / `buildSpecSheetWorkbook` / `downloadSpecSheet` (forwarded verbatim through `args`); import `resolveSheetDefault` + `PartSheetDefaults` from `lib/finishes/schema`
- [x] 11.2 In `buildSpecSheetRows`, compute `configuredDefault = resolveSheetDefault(partSheetDefaults?.[part.id]?.[activeSheet], activeVariantKey ?? null)`; when an explicit selection exists and equals `configuredDefault`, set `state = "既定"` instead of `"選択"`. No-selection fallback (`"既定"`/`"対象外"`) and undefined-default parts unchanged
- [x] 11.3 In `app/page.tsx`, pass `partSheetDefaults: state.partSheetDefaults` into the `downloadSpecSheet(...)` call
- [x] 11.4 Verify `tsc --noEmit`, `next lint`, `next build`
- [ ] 11.5 Runtime QA (needs `npm run dev`): a defaulted part untouched exports as `"既定"`; changing it to a non-default exports as `"選択"`; an undefined part's active selection still exports as `"選択"`; a part with no selection still exports as `"既定"`(fallback)/`"対象外"`
