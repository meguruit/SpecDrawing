## Context

The seed pipeline that turns `resources/catalog/部材リスト.xlsx` into `public/catalog/finish-options.json` is `scripts/extract-finish-options.mjs`. It parses each sheet by:

1. Walking every row.
2. When it sees a circled-number cell at column B (e.g. ②), starting a new part record.
3. Treating every column-D-onwards cell on that header row as a separate option.
4. Looking for the embedded swatch image at the same `(col, row + 1)` cell.
5. Scanning up to 4 trailing rows for product codes in the same columns.

The old workbook fit this model. The new `部材リスト_20260430.xlsx` does not: columns D / E / F now reserve "per-variant defaults" labelled `Natural / Flat / Sharp`, and only columns G+ list user-selectable alternatives. The same option label often appears in two of the three default columns (e.g. ⑤ レンジフード Natural=ホワイト, Flat=ブラック, Sharp=ブラック → 1 + 1 = 2 distinct options, not 3). Image anchors in `xl/drawings/drawing*.xml` no longer line up neatly under each column.

We need a parser rewrite that captures the new shape and produces a catalog the runtime can consume. The runtime change to actually *use* the new `defaultForVariants` field (auto-display defaults on boot / variant switch) is intentionally a separate follow-up.

## Goals / Non-Goals

**Goals:**
- Parse `部材リスト_20260430.xlsx` (and any future workbook with the same shape) cleanly: no false `missing-swatch` warnings, no duplicated options.
- Emit a single option per distinct label per part-sheet pair, with a `defaultForVariants` array indicating which variant columns it appeared in.
- Restore the canonical `resources/catalog/部材リスト.xlsx` filename (rename the dated copy back).
- Keep the existing `seed:variants` (cut-base-variants.mjs) flow untouched — it still cuts variant bases per the override config.
- Keep `iconUrl` emission and `sheets.json` emission untouched.

**Non-Goals:**
- Updating the runtime to auto-apply per-variant defaults (separate change).
- Backwards-compatibility with the old workbook layout — the archive in `old/` is preserved but the seed will not parse it after this change.
- Rewriting `cut-base-variants.mjs`.
- A workbook validator standalone of the seed step.

## Decisions

### Decision 1: Header-row driven column resolution

**Choice:** The parser reads row 0 of each sheet to locate the Natural / Flat / Sharp columns by header text rather than assuming columns D / E / F. Alternative columns are everything to the right of the last variant column whose header is non-empty.

**Alternatives considered:**
- *Hard-code D / E / F + G+ for variant / alt*: brittle if the customer adds a new variant or shifts columns.
- *Detect via image anchor positions*: too indirect; the workbook header is the source of truth.

**Rationale:** Header-row introspection makes the parser robust to layout shifts and self-documenting (a new "Cool" variant just adds a column header).

### Decision 2: Collapse duplicate variant labels into one option with multiple `defaultForVariants` entries

**Choice:** When `Natural / Flat / Sharp` for a part contain `["白", "白", "黒"]`, emit two options:
- `{ label: "白", defaultForVariants: ["natural", "flat"] }`
- `{ label: "黒", defaultForVariants: ["sharp"] }`

**Alternatives considered:**
- *Three options with different ids*: causes the side-list panel to show two identical "白" chips and confuses the customer.
- *Picking one variant arbitrarily as primary*: loses the information that white is the default on both natural and flat.

**Rationale:** The customer's spreadsheet model is "label → set of variants where it is default." Mirror that.

### Decision 3: Alternatives carry `defaultForVariants: []`

**Choice:** Columns G+ (alternatives) emit one option each with an empty `defaultForVariants`. The runtime distinguishes "this option is auto-applied for some variants" (non-empty array) from "this option is only available when explicitly selected" (empty array).

**Rationale:** Lets a future runtime change auto-apply defaults without re-parsing the workbook.

### Decision 4: Image-anchor matching by (col, row) lookup, not by sequential position

**Choice:** Build a `Map<cellRef, Buffer>` from `xl/drawings/drawing*.xml` (existing `buildCellImageMap`), then for each emitted option look up the image at the cell whose row is `headerRow + 1` and whose column matches that option's source column. When multiple labels share a column (because they appeared in N/F/S), only the first occurrence claims the image; subsequent occurrences reuse the same swatch.

**Rationale:** Robust to image anchors that drift one row down from the header, and to alternatives whose images may live a few columns to the right.

### Decision 5: Strict refusal of the old layout

**Choice:** After this change lands, the parser detects the new layout by looking for the literal headers `Natural`, `Flat`, `Sharp` in row 0. If they are missing, it exits with an error pointing at the archived `old/部材リスト.xlsx` for reference.

**Alternatives considered:**
- *Dual-mode parser*: keeps cruft in the codebase indefinitely.
- *Silent fallback*: hides the migration from contributors.

**Rationale:** A loud error during the migration is better than a partial parse.

### Decision 6: Schema shape — additive `defaultForVariants` only

**Choice:** Add `defaultForVariants: VariantKey[]` (default `[]`) to `finishOptionSchema`. Existing fields (`textureUrl`, `colorHex`, `thumbnailUrl`, `iconUrl`, `textureUrlByVariant`) are unchanged.

**Rationale:** Smallest surface change; backward-compatible JSON shape (old options without the field validate as `defaultForVariants: []`).

## Risks / Trade-offs

- **[Risk] Sub-rows hold multiple kinds of data** — product codes (`SP2544`), sub-labels (`電球色`), or both. The parser needs heuristics (regex on `^[A-Za-z0-9...]+$` for codes; everything else is a sub-label). The old script already used the same regex; we extend it to also capture sub-labels.
  → *Mitigation*: when a cell on the sub-row matches the code regex, treat it as `productCode`; otherwise emit it as a `subLabel` field on the option for downstream display.

- **[Risk] Same-label-different-image collisions** — if two columns both contain `"ブラック"` but the customer placed two different swatches, the second one is dropped under Decision 4.
  → *Mitigation*: emit a `duplicate-label-different-image` warning when this happens and let the designer resolve it in the workbook (probably by using distinct labels).

- **[Trade-off] Customer can't downgrade to old workbook** — once the parser flips, attempts to seed against `old/部材リスト.xlsx` fail.
  → Acceptable: the old workbook is archived for human reference, not for re-seeding.

## Migration Plan

1. Land the parser rewrite + schema field on a feature branch.
2. Rename `resources/catalog/部材リスト_20260430.xlsx` → `resources/catalog/部材リスト.xlsx` (canonical name) in the same commit. The `SPECDRAWING_WORKBOOK` env var still works as an override.
3. Run `npm run seed:parts` against the new canonical workbook. Inspect `finish-options.json` to confirm:
   - One option per distinct label per part.
   - `defaultForVariants` populated correctly (e.g. ⑤ ホワイト → `["natural"]`, ⑤ ブラック → `["flat", "sharp"]`).
   - `iconUrl` resolves for every option.
4. Re-run `npm run seed:variants` to refresh `_v_<variant>.png` cuts and `textureUrlByVariant`.
5. Smoke-test the runtime at `npm run dev` — variant switch + per-part option pick should work as before. The runtime does not yet auto-apply defaults; that lands in a follow-up change.

## Open Questions

- Sub-label storage shape: dedicated field or appended to `label` with a separator? Default to a dedicated `subLabel?: string` field.
- レコリード sheet may have a slightly different layout (it has a `※床材のみ追加` note). Run the parser against it and confirm; if it diverges, gate the new layout on アーバンシー only and treat レコリード under the legacy code path until the customer aligns it.
