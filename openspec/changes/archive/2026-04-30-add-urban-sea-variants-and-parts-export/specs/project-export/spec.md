## MODIFIED Requirements

### Requirement: Export to PNG
The system SHALL provide an "Export PNG" action that produces a downloadable PNG of the current canvas, including the active variant base image (when the active sheet is variant-enabled), all active color overrides, and all selected texture finishes resolved against the active variant. The export MUST reflect exactly what the user sees on screen at the moment of export.

#### Scenario: Export matches on-screen state
- **WHEN** the user has selected texture-mode options for two parts and a color override for one accent-cloth part, then clicks "Export PNG"
- **THEN** the downloaded PNG contains the active variant's base image, the color override applied to the correct masked region, and both texture finishes at their on-screen positions

#### Scenario: Export reflects active variant
- **WHEN** the active sheet is variant-enabled, `activeVariantKey === "sharp"`, and the user clicks "Export PNG"
- **THEN** the downloaded PNG is composited over the `sharp` base image AND every texture-mode part uses its `textureUrlByVariant["sharp"]` crop

#### Scenario: Export on empty canvas
- **WHEN** the user clicks "Export PNG" on a canvas with only a base scene and no selections
- **THEN** the downloaded PNG is the active variant's base image at the export resolution

### Requirement: Download filename
The downloaded files' names MUST follow these patterns, using the active scene id, the active variant key (or the literal `default` when no variant is active), and the local-time export timestamp at click time:

- PNG: `specdrawing-<sceneId>-<variantKey>-<YYYYMMDDHHmmss>.png`
- Excel: `specdrawing-<sceneId>-<variantKey>-<YYYYMMDDHHmmss>.xlsx`

When both files are produced by a single click, they MUST share the same `<YYYYMMDDHHmmss>` value so the pair is identifiable.

#### Scenario: Filename includes scene, variant, and timestamp
- **WHEN** the user exports while scene `main` is active with `activeVariantKey = "flat"` on 2026-05-01 at 14:30:22 local time
- **THEN** the downloaded files are `specdrawing-main-flat-20260501143022.png` and `specdrawing-main-flat-20260501143022.xlsx`

#### Scenario: Filename uses "default" when no variant active
- **WHEN** the user exports while `activeVariantKey === null`
- **THEN** the downloaded PNG is named `specdrawing-<sceneId>-default-<timestamp>.png`

## ADDED Requirements

### Requirement: Export to Excel spec sheet
The system SHALL provide an "選択部材エクスポート" action that downloads a `.xlsx` workbook listing every part in the active scene's `parts.json`, in part-number order, with the option that is currently displayed for that part on the active sheet. The displayed option resolves to:

1. the user's active selection in `partFinishSelections[partId]` when present, otherwise
2. the **default option** for `(partId, activeOptionSheet)` — the first option entry emitted by the seed pipeline for that pair (workbook order in `部材リスト.xlsx`).

Parts that have no option at all on the active sheet (zero entries from the catalog lookup) MUST still appear as a row, with the option-related columns left blank. The Excel content reflects what is "displayed" on screen, including the implicit defaults the customer has not actively touched.

The workbook MUST contain one worksheet named `選択部材`. The header row MUST label columns in Japanese in the following order: `番号 / 部位 / カテゴリ / 部材名 / 製品型番 / アイコン / 選択状態`. Each data row MUST contain:

- `番号` — the part number (e.g. `01`)
- `部位` — the part's Japanese `label`
- `カテゴリ` — the part's `category`
- `部材名` — the displayed option's `label` (or empty if no options exist on the sheet)
- `製品型番` — the displayed option's `productCode` (or empty if absent)
- `アイコン` — the displayed option's icon image embedded inline via `worksheet.addImage`, resolved from `option.iconUrl` (empty if no options exist)
- `選択状態` — the literal `"選択"` when the row used the user's active selection, `"既定"` when the row fell back to the sheet's default option, `"対象外"` when the sheet has no options for that part

Rows MUST be sorted by part number ascending so the worksheet matches the side-list order on the canvas.

#### Scenario: Excel lists every part on the active sheet
- **WHEN** the active scene declares parts `01`–`17`, the active sheet has options for every part except `15`, and the user has active selections on parts `07`, `10`
- **THEN** the downloaded `.xlsx` contains a worksheet `選択部材` with 17 data rows (one per part), in part-number order
- **AND** rows for `07` and `10` show the user's selected options with `選択状態 = "選択"`
- **AND** every other row except `15` shows the sheet's default option for that part with `選択状態 = "既定"`
- **AND** the row for `15` shows blank option columns with `選択状態 = "対象外"`

#### Scenario: Default option is the workbook's first entry per (partId, sheet)
- **WHEN** the user has not interacted with part `10` on sheet `アーバンシー` and that part has options in `部材リスト.xlsx` ordered `[A, B, C]`
- **THEN** the row for part `10` uses option `A` (its label, product code, and icon)

#### Scenario: Embedded icon per row
- **WHEN** any data row resolves to a non-blank option
- **THEN** that row's `アイコン` cell contains an inline image fetched from `option.iconUrl` and embedded via `worksheet.addImage`, sized to the row height

#### Scenario: Excel reflects active variant in filename only
- **WHEN** the user exports with `activeVariantKey = "flat"`
- **THEN** the `.xlsx` filename includes `flat` per the filename pattern, but the row content (option label, product code, icon) does not depend on the active variant

#### Scenario: Active sheet with zero options for a part
- **WHEN** an option lookup for `(partId="15", sheet="アーバンシー")` returns an empty array
- **THEN** the worksheet still contains a row for part `15` with blank option columns and `選択状態 = "対象外"`

### Requirement: Export action availability under variant flow
The export action(s) MUST be enabled when a scene is loaded, regardless of whether the active sheet has `variantsEnabled` set. Clicking with no scene loaded MUST NOT produce any download.

#### Scenario: Action enabled on variant-enabled sheet
- **WHEN** the active sheet is variant-enabled and a variant is active
- **THEN** the export action is enabled and clicking it produces both the PNG and the Excel for the active variant

#### Scenario: Action enabled on non-variant sheet
- **WHEN** the active sheet has `variantsEnabled === false` and `activeVariantKey === null`
- **THEN** the export action is enabled and clicking it produces both the PNG (using the scene's default base) and the Excel
