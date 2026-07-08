## MODIFIED Requirements

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
- `選択状態` — one of:
  - `"選択"` — the row used the user's active selection AND that selection differs from the part's effective default definition (or the part has no default definition configured);
  - `"既定"` — either the row fell back to the sheet's default option (no active selection), OR the row used the user's active selection but that selection equals the part's **effective default definition** for `(partId, activeOptionSheet)` under the active base, as configured in `default-options.json` (per `finish-spec-catalog` "Per-part default selection config" and resolved via `resolveSheetDefault(entry, activeBase)`);
  - `"対象外"` — the sheet has no options for that part.

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

#### Scenario: Active selection equal to the default definition reports 既定
- **WHEN** part `03` has a configured default of `"03-urb-0-2"` for the active sheet/base in `default-options.json`, the part started pre-selected on that default, and the user has not changed it (so `partFinishSelections["03"] === "03-urb-0-2"`)
- **THEN** the row for part `03` shows option `"03-urb-0-2"` with `選択状態 = "既定"` (not `"選択"`)

#### Scenario: Active selection different from the default definition reports 選択
- **WHEN** part `03` has a configured default of `"03-urb-0-2"` but the user has explicitly selected a different option `"03-urb-0-5"`
- **THEN** the row for part `03` shows option `"03-urb-0-5"` with `選択状態 = "選択"`

#### Scenario: Default definition resolved per active base
- **WHEN** part `14` declares `default: "14-urb-0-opt0"` and a `sharp` base override `"14-urb-syn-ブラック"`, the active base is `sharp`, and `partFinishSelections["14"] === "14-urb-syn-ブラック"` (untouched on `sharp`)
- **THEN** the row for part `14` shows `選択状態 = "既定"`; and **WHEN** the same selection `"14-urb-syn-ブラック"` is exported under a base whose effective default is `"14-urb-0-opt0"` **THEN** that row shows `選択状態 = "選択"` (the selection no longer equals the effective default)

#### Scenario: Part with no default definition reports 選択 for an active selection
- **WHEN** part `09` is not listed in `default-options.json` and the user has an active selection on it
- **THEN** the row for part `09` shows `選択状態 = "選択"` (no default-definition comparison applies)

#### Scenario: Embedded icon per row
- **WHEN** any data row resolves to a non-blank option
- **THEN** that row's `アイコン` cell contains an inline image fetched from `option.iconUrl` and embedded via `worksheet.addImage`, sized to the row height

#### Scenario: Excel reflects active variant in filename only
- **WHEN** the user exports with `activeVariantKey = "flat"`
- **THEN** the `.xlsx` filename includes `flat` per the filename pattern, but the row content (option label, product code, icon) does not depend on the active variant

#### Scenario: Active sheet with zero options for a part
- **WHEN** an option lookup for `(partId="15", sheet="アーバンシー")` returns an empty array
- **THEN** the worksheet still contains a row for part `15` with blank option columns and `選択状態 = "対象外"`
