## 1. Schema additions

- [x] 1.1 Add `defaultForVariants: z.array(z.string()).default([])` to `finishOptionSchema` in `lib/finishes/schema.ts`
- [x] 1.2 Add an optional `subLabel: z.string().min(1).optional()` to `finishOptionSchema`
- [x] 1.3 Cross-validator: every value in any option's `defaultForVariants` must match a `key` declared on the active scene's `variants[]` (extend `crossValidateOptionsAgainstSheets` or add a sibling) — added new `crossValidateDefaultsAgainstScene` and wired in `app/page.tsx`
- [x] 1.4 Update TypeScript types as needed (Zod-inferred)

## 2. Workbook reorganization

- [x] 2.1 Rename `resources/catalog/部材リスト_20260430.xlsx` → `resources/catalog/部材リスト.xlsx` (canonical name) so the seed picks it up by default
- [x] 2.2 Confirm `resources/catalog/old/部材リスト.xlsx` stays in place as historical reference

## 3. Parser rewrite (`scripts/extract-finish-options.mjs`)

- [x] 3.1 Read each sheet's row 0 and locate the `Natural`, `Flat`, `Sharp` column indices by header text (case-insensitive). Exit non-zero if any are missing.
- [x] 3.2 For each part header row (circled-number cell at column B), extract per-variant default cells AND alternative cells (everything past the rightmost variant column)
- [x] 3.3 Collapse same-label variant defaults into a single emitted option whose `defaultForVariants` lists every matching variant key
- [x] 3.4 Emit each alternative cell as a separate option with `defaultForVariants: []`
- [x] 3.5 Sub-row scan: for rows `headerRow + 1` through `headerRow + 4`, for each option's source column, classify the cell as `productCode` (matches `/^[A-Za-z0-9][A-Za-z0-9\s\-./]*$/`) or `subLabel` (other non-empty Japanese text)
- [x] 3.6 When same-label collapse merges columns whose product codes disagree, emit a `label-collapse-product-code-conflict` warning with both codes and pick the leftmost
- [x] 3.7 Image-anchor lookup: build the cell→buffer map; for each emitted option, look up at sourceCols[0] and fall back to other source columns for collapsed options. (Also fixed a long-standing regex bug in `<a:blip>` parsing that broke on `xmlns:r` URLs in the new workbook — the regex `[^/>]+` stopped at the first `/` in `http://`.)
- [x] 3.8 Emit `iconUrl` per option as before (96×96 from the swatch); preserve existing `sheets.json` emission
- [x] 3.9 ~~Refuse the legacy layout~~ — softened to **fall back to legacy layout** for sheets missing variant headers (per design.md Open Question). レコリード is still on the legacy layout; auto-detect and parse it without erroring.

## 4. Seeding + smoke test

- [x] 4.1 Run `npm run seed:parts` against the canonical workbook; 183 options, 4 missing-swatch warnings (expected for ② 有/無 which lack visual swatches)
- [x] 4.2 Inspect emitted `defaultForVariants`: ⑤ ホワイト → `["natural"]`, ブラック → `["flat", "sharp"]`; ⑦ ダークホワイト → `["natural", "flat", "sharp"]` + 4 alternatives with `[]`; ① 白 → `["natural", "flat"]`, 黒 → `["sharp"]`; レコリード legacy options all `[]`
- [x] 4.3 Run `npm run seed:variants`; 39 PNGs cut, 0 warnings
- [x] 4.4 Boot `npm run dev` + browser smoke: variant switcher visible on アーバンシー, option chip click updates side list, variant + option combination renders correctly on canvas

## 5. Documentation

- [x] 5.1 Update `resources/reference/AUTHORING.md` with a new "部材リスト.xlsx — variant-keyed columns" section replacing the prior "column conventions" subsection; document Natural/Flat/Sharp + alternatives layout, sub-row product codes / sub-labels, and the collapse rule
- [x] 5.2 Add a portfolio entry in `openspec/OVERVIEW_JA.md` §6.3 covering this change

## 6. Tests (deferred — no test runner yet)

> DEFERRED — same gating as the parent change: vitest needs to be wired up first.

- [ ] 6.1 Parser test: hand-build a tiny .xlsx fixture with the new column layout; assert option count, `defaultForVariants` correctness, sub-label / product-code split
- [ ] 6.2 Schema test: option with unknown variant key in `defaultForVariants` rejected
- [ ] 6.3 Migration test: legacy fixture (no `Natural`/`Flat`/`Sharp` row-0 headers) causes seed to exit non-zero

## 7. Final validation

- [x] 7.1 Run `openspec validate rewrite-seed-for-variant-keyed-workbook --strict` — clean
- [x] 7.2 Run `npm run typecheck` and `npm run lint` — both clean
- [x] 7.3 Confirm `add-urban-sea-variants-and-parts-export` parent change's tasks 2.2 / 2.3 / 2.8 are still deferred (this change does NOT flip parts.json #15 #17)
