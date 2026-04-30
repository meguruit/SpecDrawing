## 1. Schema changes

- [x] 1.1 Extend `finishOptionSchema` in [lib/finishes/schema.ts](../../../lib/finishes/schema.ts) with optional `colorHexByVariant: { natural?, flat?, sharp? }` (each `^#[0-9A-Fa-f]{6}$`). Reject the field on texture-mode options
- [x] 1.2 Tighten `crossValidateOptionsAgainstSheets` in [lib/finishes/load.ts](../../../lib/finishes/load.ts): if `colorHexByVariant` is present, every key MUST be one of the active scene's `variants[].key`
- [x] 1.3 Add `variantMappingSchema` (Zod) for `resources/catalog/finish-variant-mapping.json` covering `overrides`, `noEffect`, and `colorHexByVariant` blocks; reject unknown variant keys, unknown partIds, and option labels that don't exist on `アーバンシー`'s emitted options (after synthesis)
- [x] 1.4 Add `tintBaseSchema` (Zod) for the new `tintBase` block in [resources/catalog/finish-base-overrides.json](../../../resources/catalog/finish-base-overrides.json); reject when the named `label` doesn't match any option on the part for the active scene's sheet
- [x] 1.5 Update TypeScript types as needed (Zod-inferred — `VariantMapping`, `FinishBaseOverrides`, `tintBaseSchema` all auto-inferred)

## 2. Seed pipeline — variant mapping overrides

- [x] 2.1 Create `resources/catalog/finish-variant-mapping.json` with the four `overrides` blocks (⑩ ⑪ ⑬ ⑭) and the empty `noEffect` and `colorHexByVariant` sections from proposal.md §1
- [x] 2.2 In [scripts/cut-base-variants.mjs](../../../scripts/cut-base-variants.mjs), load `finish-variant-mapping.json` after the workbook-emitted options are in memory; for each `(partId, variantKey, optionLabel)` triple, mutate `defaultForVariants` on the matching option (add the variant key) and remove that key from any prior claimant
- [x] 2.3 Cross-sheet synthesis for ⑭: when an override references an option label that doesn't exist on `アーバンシー`, search `レコリード` for the same `(partId, label)`, copy the option (preserving icon, productCode, subLabel) and tag it `synthesized: true`. On no match, append a `missing-overridden-option` warning to `finish-options.warnings.json`
- [x] 2.4 Re-derive `textureUrlByVariant` AFTER the mapping mutations so each variant key on each option points at the correct `_v_<variant>.png` (the override-promoted option claims the variant base; demoted options fall through to tint-base if configured, else swatch fallback)
- [x] 2.5 On startup, log every active override (count + part list) so seed-time effects are auditable

## 3. Seed pipeline — tint-base alternatives

- [x] 3.1 Extend [resources/catalog/finish-base-overrides.json](../../../resources/catalog/finish-base-overrides.json) with a `tintBase` block: `{ "10": { "label": "ｺｺﾅｯﾂﾁｪﾘｰ" }, "13": { "label": "ｸﾞﾚｰｼﾞｭ" }, "15": { "label": "ﾅﾗ樫" } }`
- [x] 3.2 In `cut-base-variants.mjs`, after the per-part `_v_<variant>.png` step, for each part with a `tintBase` entry: derive the tint-base variant key from the named option's `defaultForVariants`; load `_v_<tintBaseVariant>.png`; convert RGB to luminance (`Y = 0.2126·R + 0.7152·G + 0.0722·B`) using sharp's `toColorspace("b-w").linear()` or equivalent
- [x] 3.3 Helper `dominantNonWhiteColor(iconBuffer): { r, g, b }` — load the option's `iconUrl` PNG, drop pixels where `min(R,G,B) > 240`, return the mean of the rest. Emit a `tint-color-low-confidence` warning when the per-channel variance exceeds a threshold
- [x] 3.4 For each alternative option (`defaultForVariants: []`) on a tint-base part: multiply the monotone × dominant icon color, write `<partId>/<optionId>__<variantKey>.png` × 3 (one per scene variant key, byte-identical content), set `option.textureUrlByVariant[v] = { url, textureBox }` for each variant
- [x] 3.5 Idempotency: re-running `seed:variants` with unchanged inputs MUST produce byte-identical tint outputs

## 4. Seed pipeline — ambient-fill *無* texture

- [x] 4.1 Add a `noEffect` block to `finish-variant-mapping.json`: `[{ "partId": "02", "optionLabel": "無" }]`
- [x] 4.2 In `cut-base-variants.mjs`, for each `noEffect` entry: load every variant base; dilate the part's mask by 16 px (sharp's `convolve` with a 33×33 kernel, or a 3-pass box blur fallback); subtract the original mask → "neighborhood ring"; compute mean RGB inside the ring per variant
- [x] 4.3 Output a solid-RGB PNG sized to the part bbox (alpha = original mask alpha) per variant, write to `<partId>/<optionId>__<variantKey>.png`; set `option.textureUrlByVariant`
- [x] 4.4 Confirm part ② mask + bbox is non-empty in [public/assets/base/main/parts.json](../../../public/assets/base/main/parts.json) before running

## 5. Runtime — `colorHexByVariant`

- [x] 5.1 Update [components/parts/PartFinishLayer.tsx](../../../components/parts/PartFinishLayer.tsx) lines ~134-141 (color-mode `Rect.fill`): read `option.colorHexByVariant?.[activeVariantKey] ?? option.colorHex`
- [x] 5.2 The cache-bust `?v=<_rev>` already covers JSON content; verify no extra runtime cache invalidation is needed

## 6. Sash palette helper + ⑰ data

- [x] 6.1 Build `scripts/suggest-sash-palette.mjs`: for each variant base + part ⑰, sample the mean RGB in a 32-px-wide ring outside the mask; print suggested per-variant hex values for each existing ⑰ option (using a multiply/blend rule the designer can tune)
- [x] 6.2 Designer curates `colorHexByVariant` for the 4 ⑰ options (`カームブラック`, `ホワイト`, `プラチナステン`, `ブラウン`); commit the values into the `colorHexByVariant` block of `finish-variant-mapping.json`
- [x] 6.3 Apply the curated values into `finish-options.json` via `cut-base-variants.mjs` so the runtime sees them

## 7. Data audit

- [x] 7.1 Walk every `アーバンシー` option for parts ⑩ ⑪ ⑬ ⑭ ⑮ ② ⑰ and confirm `(label, iconUrl, dominant texture color)` agree. Log any divergences for review (built `scripts/audit-finish-options.mjs`; current run reports 14 distance-threshold "warnings" all explainable by the tint pipeline's multiply-blend darkening — no actual mismatches)
- [x] 7.2 Resolve each divergence by either (a) workbook fix request to customer, (b) override entry in `finish-variant-mapping.json`, or (c) explicit "this is intended" annotation in the change log (all current findings are tint-pipeline artifacts; no workbook fix needed)
- [x] 7.3 Re-run `seed:parts → seed:variants` and confirm `aurban-sea-variants` end-to-end smoke (open `/`, switch variants on `アーバンシー`, click each affected part) shows the corrected mappings (seed re-run clean, runtime smoke is Section 9 — interactive)

## 8. Documentation

- [x] 8.1 Add a `## Finish-variant-mapping config` section to [resources/reference/AUTHORING.md](../../../resources/reference/AUTHORING.md) covering `overrides`, `noEffect`, `colorHexByVariant`, and `tintBase`; show the four ⑩ ⑪ ⑬ ⑭ examples and the ② / ⑰ examples
- [x] 8.2 Update [openspec/OVERVIEW_JA.md](../../../openspec/OVERVIEW_JA.md) §6 with a short note about the new override layer (workbook is option-set source of truth; designer-owned config remaps variants)
- [x] 8.3 Run `openspec validate improve-finish-fidelity --strict` and resolve any reported issues

## 9. Smoke / acceptance

- [x] 9.1 `/` smoke on `アーバンシー`: switch through Natural / Flat / Sharp; confirm ⑩ shows ココナッツチェリー / ダージリンウォルナット / エスプレッソウッド respectively; ⑪ shows シルバー / ゴールド / ブラック; ⑬ shows ナチュラルクリア / グレージュ / ショコラブラック; ⑭ shows シルバー / シルバー / ブラック; ⑮ shows ハードメープル / ナラ樫 / アカシア — confirmed OK
- [x] 9.2 `/` smoke: ⑩ alternative tint-base rendering — confirmed OK; tuned `lift` to 0.35 for ⑩/⑬ and 0.15 for ⑮ in [finish-base-overrides.json](../../../resources/catalog/finish-base-overrides.json)
- [x] 9.3 `/` smoke: ② *無* — initial ambient-fill matched the bloom halo (16-px ring picked up spillover), making the strip merge into the halo. Fix: added `dilate` / `dim` / `targetHex` to the `noEffect` schema; ② 無 now uses `dilate: 80, dim: 0.55` so the fill is ~50% darker than the base
- [x] 9.4 `/` smoke: ⑰ サッシ枠 — color-mode shading was too strong (#0D130F カームブラック read as crushed black). Fix: extended `tintBase` to support color-mode entries with no `label` (lifts `shading_<id>.png` in-place); ⑰ now uses `lift: 0.55`
- [x] 9.5 `/` smoke: Excel export bug — when no explicit selection on a part, the export's "既定" row resolved to `sheetOptions[0]` (workbook order = always Natural's option) regardless of active variant. Fix: thread `activeVariantKey` through to `buildSpecSheetRows` and pick the option whose `defaultForVariants` includes the active variant before falling back to workbook order ([spec-sheet.ts](../../../lib/export/spec-sheet.ts))
