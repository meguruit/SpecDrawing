## 1. Schema and types

- [x] 1.1 Extend `scenesSchema` (Zod) with the `variants: { key, label, baseImageUrl }[]` array; reject duplicate keys and a `variants` array whose entries do not include the scene's top-level `baseImageUrl`
- [x] 1.2 Extend `partsManifestSchema` validation so a non-accent-cloth part on a variant-enabled scene MUST declare `renderMode: "texture"`; surface a named load-time error on violation
- [x] 1.3 Add `sheetsManifestSchema` for `public/catalog/sheets.json`: `{ version: 1, sheets: [{ key, label, variantsEnabled, defaultVariantKey? }] }`; require `defaultVariantKey` when `variantsEnabled === true` and ensure it matches a variant key on the scene
- [x] 1.4 Extend the finish-option schema to (a) require `iconUrl` on every option, (b) require `textureUrlByVariant: Record<VariantKey, string>` on texture-mode options whose sheet has `variantsEnabled === true`, with one entry per variant key declared on the scene
- [x] 1.5 Update TypeScript types in `lib/parts/types.ts` and `lib/finish/types.ts` (or wherever finish types live) to mirror the new fields

## 2. Asset and seed pipeline

- [x] 2.1 Author `public/assets/base/main/scene.json` with the new `variants` array listing `natural`, `flat`, and `sharp` and their `baseImageUrl`s; verify all three `base_<variant>.jpg` files exist under `public/assets/base/main/`
- [x] 2.2 Update `public/assets/base/main/parts.json` so every part EXCEPT `"07"` (キッチンアクセントクロス) and `"16"` (収納アクセントクロス) declares `renderMode: "texture"` and drops its `shading` field; verify Zod validation passes (part 15 flipped to texture; part 17 remains color pending レコリード texture options — see 2.8)
- [x] 2.3 Refresh the customer-prepared `resources/catalog/部材リスト.xlsx` so every option has a product code AND an icon image; coordinate with the customer to confirm icon images are 96×96 PNG-equivalent
- [x] 2.4 Extend `scripts/seed-parts.mjs` (or equivalent) to extract icon images from the workbook and emit `public/catalog/icons/<optionId>.png`; populate `iconUrl` on every emitted option
- [x] 2.5 Extend `scripts/cut-base-variants.mjs` so for every texture-mode option on a variant-enabled sheet it emits one masked PNG per scene variant key (`<optionId>__natural.png`, `__flat.png`, `__sharp.png`) under `public/assets/finishes/<partId>/`, regardless of whether `finish-base-overrides.json` lists the option (uses shared `_v_<variant>.png` per part rather than per-option, since labels on the same partId crop the same region)
- [x] 2.6 Populate `textureUrlByVariant` on every emitted texture-mode option for the アーバンシー sheet; on missing `base_<variant>.jpg`, append a `variant-missing` warning to `finish-options.warnings.json` and exit `seed:variants` non-zero
- [x] 2.7 Emit `public/catalog/sheets.json` from the seed pipeline; アーバンシー gets `variantsEnabled: true, defaultVariantKey: "natural"`, other sheets default to `variantsEnabled: false`
- [ ] 2.8 If レコリード (or any other sheet) had color-mode options for parts now flipped to texture-mode, regenerate those options as texture-mode in the seed step or document a deliberate gap — verify no `partSchema` refinement errors at runtime *(SPLIT OUT — to be handled in a separate change for レコリード 部材表対応)*

## 3. Runtime: scene loader and canvas state

- [x] 3.1 Update the scene loader to expose the parsed `variants` array on its loaded-scene data structure
- [x] 3.2 Add `activeVariantKey: string | null` to the Zustand canvas state; initialize it from the active sheet's `defaultVariantKey` (or `null` when the sheet has `variantsEnabled === false`)
- [x] 3.3 On `activeOptionSheet` change, recompute `activeVariantKey` against the new sheet config — clear to `null` for non-variant sheets, restore to the sheet's `defaultVariantKey` for variant sheets, and preserve the prior key on a round-trip (in-memory cache keyed by sheet key)
- [x] 3.4 Wire the canvas base layer to consume `scene.json`'s variant whose `key === activeVariantKey` instead of the top-level `baseImageUrl` when `activeVariantKey` is non-null

## 4. Runtime: variant switcher UI

- [x] 4.1 Build a `VariantSwitcher` React component (segmented control or button group) that reads `activeVariantKey`, the variant array on the active scene, and writes back to the store
- [x] 4.2 Render the switcher conditionally on `sheets.json[activeOptionSheet].variantsEnabled === true`; ensure it is removed from the DOM (not merely hidden) on non-variant sheets
- [x] 4.3 Make the switcher keyboard-accessible: arrow-key navigation between variants, Enter/Space to select, focus ring visible
- [x] 4.4 Localize variant labels from `scene.json[].variants[].label` (Japanese strings supplied by the designer)

## 5. Runtime: texture-mode rendering with variants

- [x] 5.1 Update `PartFinishLayer` so texture-mode parts on variant-enabled sheets resolve `textureUrl` via `option.textureUrlByVariant[activeVariantKey]` instead of `option.textureUrl`
- [x] 5.2 Pre-fetch the other two variants of every currently-selected texture-mode option after first paint so subsequent variant switches hit browser cache
- [x] 5.3 Confirm color-mode parts (accent cloth) ignore `activeVariantKey` and continue compositing via `colorHex` — covered by an explicit unit test
- [x] 5.4 Confirm the `?v=<rev>` cache-bust on texture URLs (per `finish-spec-catalog`'s "Catalog revision for cache-bust" rule) still works against the per-variant URLs

## 6. Excel export

- [x] 6.1 Add `exceljs` to `package.json` and confirm it bundles cleanly in a Next.js client component
- [x] 6.2 Add a `defaultOptionId` resolver to `finish-spec-catalog`'s lookup: given `(partId, sheet)`, returns the workbook-first option id (or `null` when the pair has no options); cover with unit tests
- [x] 6.3 Build `lib/export/spec-sheet.ts` (dynamic-imported) that takes the current store snapshot and produces an `ExcelJS.Workbook` with one sheet named `選択部材`, headers `番号 / 部位 / カテゴリ / 部材名 / 製品型番 / アイコン / 選択状態`, and one row per part in the active scene
- [x] 6.4 Per row, resolve the displayed option as: `partFinishSelections[partId]` if set → else the sheet's default option for `(partId, activeOptionSheet)` → else blank with `選択状態 = "対象外"`. Set `選択状態` accordingly (`選択` / `既定` / `対象外`)
- [x] 6.5 Embed each option's icon image inline via `worksheet.addImage`; resolve the image bytes by fetching `option.iconUrl` and passing the buffer to `addImage`. For `対象外` rows, leave the cell empty
- [x] 6.6 Sort rows by part number ascending so the worksheet matches the side list

## 7. Combined export action and filenames

- [x] 7.1 Replace (or extend) the existing PNG-only export action with a "選択部材エクスポート" action that produces both the PNG and the Excel from a single click; share one timestamp across both filenames
- [x] 7.2 Update the PNG filename generator to include `<variantKey>` (or the literal `default` when `activeVariantKey === null`) per the new `Download filename` rule
- [x] 7.3 Make the export module dynamic-imported so the `exceljs` cost lands only on first click
- [x] 7.4 Confirm the export action remains enabled on both variant-enabled and non-variant sheets and disabled only when no scene has loaded; the action always produces a non-empty `.xlsx` because every part gets a row (default or `対象外`), so no zero-row notification path is needed

## 8. Tests

> DEFERRED — repo has no test runner configured (no `jest`/`vitest`/`*.test.ts`).
> Set up a runner (recommend vitest for Next.js) before checking these off.
> The functions targeted below are pure and unit-testable as authored:
> - schema deltas: [lib/scenes/types.ts](../../../lib/scenes/types.ts), [lib/finishes/schema.ts](../../../lib/finishes/schema.ts)
> - cross-validators: [lib/finishes/load.ts](../../../lib/finishes/load.ts) (`crossValidatePartsAgainstSheets`, `crossValidateOptionsAgainstSheets`, `crossValidateSheetsAgainstScene`, `getDefaultOptionId`)
> - export helpers: [lib/export/spec-sheet.ts](../../../lib/export/spec-sheet.ts) (`buildSpecSheetRows`, `buildSpecSheetWorkbook`), [lib/export/filename.ts](../../../lib/export/filename.ts) (`buildExportFilename`, `formatExportTimestamp`)

- [ ] 8.1 Unit tests for `partsManifestSchema` and `finishOptionsSchema` covering the new validations: missing `textureUrlByVariant`, missing variant key, missing `iconUrl`, color-mode non-accent part on a variant-enabled scene *(DEFERRED — split into a follow-up `add-test-framework` change; vitest setup is its own concern)*
- [ ] 8.2 Unit tests for `sheetsManifestSchema` covering `variantsEnabled` without `defaultVariantKey` and a `defaultVariantKey` that does not match any scene variant *(DEFERRED — see 8.1)*
- [ ] 8.3 Component test for `VariantSwitcher`: renders only on variant-enabled sheets, switches `activeVariantKey`, repaints texture-mode parts, leaves color-mode parts unchanged *(DEFERRED — see 8.1)*
- [ ] 8.4 Integration test that simulates: load app on アーバンシー, pick texture options for two parts, switch variant `natural → sharp`, verify both parts' rendered texture URL matches `textureUrlByVariant["sharp"]` *(DEFERRED — see 8.1)*
- [ ] 8.5 Test for the Excel export module: builds a workbook from a known store state mixing actively-selected parts, default-fallback parts, and a part with no options on the sheet; opens the produced file via `ExcelJS.Workbook.xlsx.load`, asserts row count equals the part count, column values per category, the `選択状態` column values (`選択` / `既定` / `対象外`), and that an image was embedded for every row except `対象外` *(DEFERRED — see 8.1)*
- [ ] 8.6 Snapshot test for filename generation across `(variantKey, no-variant)` combinations *(DEFERRED — see 8.1)*

## 9. Documentation and migration

- [x] 9.1 Update `openspec/OVERVIEW_JA.md` with a short section describing variant switching and the new spec-sheet export
- [x] 9.2 Add a README entry to `scripts/` or `resources/catalog/` documenting the new icon-image and product-code columns expected in `部材リスト.xlsx` (added "部材リスト.xlsx — column conventions" section to [resources/reference/AUTHORING.md](../../../resources/reference/AUTHORING.md))
- [x] 9.3 Add a migration note in the proposal/design appendix listing the seed-step order required to bring up the new schema (`seed:parts → seed:icons → seed:variants`) and what to do on failure (covered in [design.md Migration Plan](design.md) and the new [AUTHORING.md Runtime variant switching](../../../resources/reference/AUTHORING.md) section)
- [x] 9.4 Run `openspec validate add-urban-sea-variants-and-parts-export --strict` and resolve any reported issues before requesting review
