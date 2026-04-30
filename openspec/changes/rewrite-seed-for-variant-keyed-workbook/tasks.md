## 1. Schema additions

- [ ] 1.1 Add `defaultForVariants: z.array(z.string()).default([])` to `finishOptionSchema` in `lib/finishes/schema.ts`
- [ ] 1.2 Add an optional `subLabel: z.string().min(1).optional()` to `finishOptionSchema`
- [ ] 1.3 Cross-validator: every value in any option's `defaultForVariants` must match a `key` declared on the active scene's `variants[]` (extend `crossValidateOptionsAgainstSheets` or add a sibling)
- [ ] 1.4 Update TypeScript types as needed

## 2. Workbook reorganization

- [ ] 2.1 Rename `resources/catalog/部材リスト_20260430.xlsx` → `resources/catalog/部材リスト.xlsx` (canonical name) so the seed picks it up by default
- [ ] 2.2 Confirm `resources/catalog/old/部材リスト.xlsx` stays in place as historical reference

## 3. Parser rewrite (`scripts/extract-finish-options.mjs`)

- [ ] 3.1 Read each sheet's row 0 and locate the `Natural`, `Flat`, `Sharp` column indices by header text (case-insensitive). Exit non-zero if any are missing.
- [ ] 3.2 For each part header row (circled-number cell at column B), extract:
  - the per-variant default cells (one per variant column),
  - the alternative cells (everything to the right of the rightmost variant column whose row-0 header is non-empty).
- [ ] 3.3 Collapse same-label variant defaults into a single emitted option whose `defaultForVariants` lists every matching variant key
- [ ] 3.4 Emit each alternative cell as a separate option with `defaultForVariants: []`
- [ ] 3.5 Sub-row scan: for rows `headerRow + 1` through `headerRow + 4`, for each option's source column, classify the cell as `productCode` (matches `/^[A-Za-z0-9][A-Za-z0-9\s\-./]*$/`) or `subLabel` (other non-empty Japanese text)
- [ ] 3.6 When same-label collapse merges columns whose product codes disagree, emit a `label-collapse-product-code-conflict` warning with both codes and pick the leftmost
- [ ] 3.7 Image-anchor lookup: build the cell→buffer map from `xl/drawings/drawing*.xml`, then for each emitted option search `headerRow + 1` at the option's source column (or columns, for collapsed options) for the swatch. Reuse one swatch per collapsed option.
- [ ] 3.8 Emit `iconUrl` per option as before (96×96 from the swatch); preserve existing `sheets.json` emission
- [ ] 3.9 Refuse the legacy layout: when `Natural`/`Flat`/`Sharp` are absent from row 0, exit non-zero with a message naming the sheet and pointing at `old/部材リスト.xlsx`

## 4. Seeding + smoke test

- [ ] 4.1 Run `npm run seed:parts` against the canonical workbook; confirm `finish-options.json` lists one option per distinct label per part-sheet pair
- [ ] 4.2 Inspect emitted `defaultForVariants` for representative parts: ⑤ レンジフード should have `ホワイト → ["natural"]` and `ブラック → ["flat", "sharp"]`; ⑦ アクセントクロス should have one variant default + four empty-default alternatives
- [ ] 4.3 Run `npm run seed:variants`; confirm no regressions in `_v_<variant>.png` cuts and `textureUrlByVariant` content
- [ ] 4.4 Boot `npm run dev`, switch variants, pick options, verify the previously-fixed "selected option keeps its texture across variants" behavior still holds

## 5. Documentation

- [ ] 5.1 Update `resources/reference/AUTHORING.md` with a new "部材リスト.xlsx — variant-keyed columns" section replacing the prior "column conventions" subsection; document Natural/Flat/Sharp + alternatives layout, sub-row product codes / sub-labels, and the collapse rule
- [ ] 5.2 Add a portfolio entry in `openspec/OVERVIEW_JA.md` (or update §6's existing アーバンシー entry) noting that `add-urban-sea-variants-and-parts-export` only handles the runtime, and `rewrite-seed-for-variant-keyed-workbook` lands the workbook parser

## 6. Tests (deferred — no test runner yet)

> DEFERRED — same gating as the parent change: vitest needs to be wired up first.

- [ ] 6.1 Parser test: hand-build a tiny .xlsx fixture with the new column layout; assert option count, `defaultForVariants` correctness, sub-label / product-code split
- [ ] 6.2 Schema test: option with unknown variant key in `defaultForVariants` rejected
- [ ] 6.3 Migration test: legacy fixture (no `Natural`/`Flat`/`Sharp` row-0 headers) causes seed to exit non-zero

## 7. Final validation

- [ ] 7.1 Run `openspec validate rewrite-seed-for-variant-keyed-workbook --strict`
- [ ] 7.2 Run `npm run typecheck` and `npm run lint`
- [ ] 7.3 Confirm `add-urban-sea-variants-and-parts-export` parent change's tasks 2.2 / 2.3 / 2.8 are still deferred (this change does NOT flip parts.json #15 #17)
