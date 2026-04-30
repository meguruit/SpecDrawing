## Why

The customer re-issued `部材リスト_20260430.xlsx` with a fundamentally different column layout. The old workbook listed each part's options in column D onward as a flat sequence; the new workbook reserves columns D / E / F for **per-variant defaults** ("Natural / Flat / Sharp") and uses columns G+ only for **alternative options** the customer can swap in.

`extract-finish-options.mjs` (the `seed:parts` script) was written against the old layout and currently mis-parses the new one — it treats the three variant-default columns as three separate options with collisions on the same `(partId, label)` pair, anchors images at the wrong cells (the new workbook puts swatches on row + 1 in different columns), and emits 198 `missing-swatch` warnings on a single run. The runtime is currently held together by pointing the seed at the archived old workbook (`SPECDRAWING_WORKBOOK=resources/catalog/old/部材リスト.xlsx`); we cannot ship customer-driven option changes until the seed understands the new layout.

This change rewrites the workbook parser around the new layout, distinguishes variant-default rows from alternatives, and brings the canonical `部材リスト.xlsx` filename back as the seed input.

## What Changes

- Rewrite `scripts/extract-finish-options.mjs` to:
  - Read the header row and locate Natural / Flat / Sharp columns by name (instead of assuming columns D / E / F).
  - For each part header row, emit at most ONE "per-variant default" option per distinct label — collapsing "白/白/黒" into two options ("白" with `defaultForVariants: [natural, flat]`, "黒" with `defaultForVariants: [sharp]`) instead of three options with two duplicates.
  - For each part header row, emit each column-G+ value as an "alternative" option with `defaultForVariants: []`.
  - Read product codes from the second sub-row (row + 1 under each part header), and sub-labels (e.g. ②'s 電球色 / 光無し) from the same sub-row when present.
  - Resolve image anchors from `xl/drawings/drawing*.xml` and match them to whichever cell (column × row) actually holds the swatch — the new workbook anchors images on the row below the header, sometimes in a different column from the label.
- Add a `defaultForVariants: VariantKey[]` field to the finish-option schema. Variant-default options carry a non-empty array; alternatives carry an empty array. The runtime uses this to decide whether an option should be auto-displayed when the customer has not made a manual selection (see follow-up runtime change, out of scope here).
- **BREAKING (designer-side)**: the old workbook layout (where every column D+ was an option) is no longer supported. The `old/部材リスト.xlsx` archive is preserved for historical reference but the seed pipeline will refuse to parse it.
- Remove the `SPECDRAWING_WORKBOOK` env-var fallback once the new parser is the default; rename `部材リスト_20260430.xlsx` to canonical `部材リスト.xlsx` so the seed picks it up without configuration.
- Update `extract-finish-options.mjs` regression tests (TBD when test runner lands) to cover: per-variant defaults, alternatives, sub-rows, and image anchor offsets.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities

- `finish-spec-catalog`: option entries gain `defaultForVariants: VariantKey[]`. The seed pipeline rule "every option corresponds to one column under a part header" is replaced with the new variant-default + alternative split. The catalog file's shape changes; old `finish-options.json` files no longer validate.

## Impact

- **Code**: `scripts/extract-finish-options.mjs` (full rewrite of the per-sheet parser), plus minor schema additions in `lib/finishes/schema.ts` and surfacing of `defaultForVariants` through the runtime types.
- **Assets**: `resources/catalog/部材リスト.xlsx` becomes the canonical input again (rename of `部材リスト_20260430.xlsx`); the old archived workbook stays under `resources/catalog/old/`.
- **Runtime (out of scope here)**: a follow-up change should consume `defaultForVariants` so the canvas auto-displays the matching default on a fresh boot or after a variant switch.
- **Schema**: `finishOptionSchema` gains `defaultForVariants: z.array(z.string()).default([])`. Existing emit paths that only use `colorHex` / `textureUrl` are unchanged.
- **Out of scope**: runtime auto-application of variant defaults; rewrite of `cut-base-variants.mjs` (it can keep its current per-option override behavior); workbook-to-workbook migration helpers (the customer drives the workbook).
