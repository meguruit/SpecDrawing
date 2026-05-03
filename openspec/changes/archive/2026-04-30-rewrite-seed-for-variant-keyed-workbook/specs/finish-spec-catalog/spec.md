## ADDED Requirements

### Requirement: defaultForVariants on every finish-option entry
Every finish-option entry MUST carry a `defaultForVariants: VariantKey[]` field. The array enumerates every variant key on which this option is the customer-facing default — i.e. the option that is auto-displayed before the customer picks anything else on that variant.

- A non-empty array (`["natural"]`, `["flat", "sharp"]`, etc.) marks the option as a per-variant default.
- An empty array marks the option as an "alternative": only displayed when the customer actively selects it.

The seed pipeline SHALL populate this field by reading the workbook's `Natural / Flat / Sharp` columns under each part header. Two columns that share the same label collapse into one option entry whose `defaultForVariants` lists every matching variant. Columns to the right of the variant block (alternatives) emit one option each with `defaultForVariants: []`.

#### Scenario: One option per distinct label per part-sheet
- **WHEN** the workbook lists part ⑤ レンジフード on アーバンシー with `Natural=ホワイト, Flat=ブラック, Sharp=ブラック`
- **THEN** the catalog contains exactly two options for `(partId="05", sheet="アーバンシー")`:
  - `{ label: "ホワイト", defaultForVariants: ["natural"] }`
  - `{ label: "ブラック", defaultForVariants: ["flat", "sharp"] }`

#### Scenario: Alternative columns emit empty defaultForVariants
- **WHEN** the workbook lists part ⑦ キッチンアクセントクロス with `Natural=ダークホワイト, Flat=ダークホワイト, Sharp=ダークホワイト` and alternatives `サンドベージュ / スカイグレー / アッシュグレー / エクルベージュ`
- **THEN** the catalog contains one option `{ label: "ダークホワイト", defaultForVariants: ["natural", "flat", "sharp"] }` AND four options whose `defaultForVariants` is `[]`

#### Scenario: defaultForVariants references unknown variant key rejected
- **WHEN** any option's `defaultForVariants` contains a string that does not match a `key` declared by the active scene's `variants` array
- **THEN** validation fails at load time naming the option id and the unknown variant key

### Requirement: Header-driven workbook column resolution
The seed pipeline (`scripts/extract-finish-options.mjs`) SHALL determine each sheet's layout by reading row 0:

- If row 0 contains the labels `Natural`, `Flat`, AND `Sharp` (case-insensitive, in any columns), the sheet is parsed under the **variant-keyed layout**: those three columns hold per-variant defaults, and every column to the right of the rightmost detected variant column holds alternatives.
- If row 0 is missing one or more of those labels, the sheet falls back to the **legacy layout**: every column under the part header row is treated as a sequential option whose `defaultForVariants` is `[]`.

The seed step MUST NOT exit non-zero solely because a sheet is on the legacy layout — sheets in transition coexist with already-migrated sheets while the customer rolls the workbook forward. Each parsed sheet emits a one-line log entry naming its detected layout.

#### Scenario: Variant headers detected → variant-keyed layout
- **WHEN** sheet `アーバンシー` row 0 contains `Natural`, `Flat`, `Sharp`
- **THEN** the parser uses the variant-keyed layout
- **AND** the parser logs `sheet "アーバンシー" parsed (variant-keyed layout, N parts)`

#### Scenario: Missing variant headers → legacy layout fallback
- **WHEN** sheet `レコリード` row 0 has no variant headers
- **THEN** the parser falls back to the legacy layout and emits options with `defaultForVariants: []`
- **AND** the parser logs `sheet "レコリード" parsed (legacy layout, N parts)`
- **AND** the seed step continues processing other sheets without erroring

### Requirement: Sub-row product codes and sub-labels
Per part header row, the seed pipeline MUST scan rows `headerRow + 1` through `headerRow + 4` for additional metadata in the same columns as the option labels. A cell whose value matches `/^[A-Za-z0-9][A-Za-z0-9\s\-./]*$/` MUST be treated as the option's `productCode`; any other non-empty Japanese-text cell MUST be captured as the option's optional `subLabel`.

When a label collapse merges multiple variant columns into one option, the product code MUST come from the first column whose row-+1 cell is non-empty; if multiple columns disagree, an entry of `kind: "label-collapse-product-code-conflict"` MUST be appended to `finish-options.warnings.json` naming the option id and the conflicting codes.

#### Scenario: Product code in sub-row populates the option
- **WHEN** part ⑤ row 13 (sub-row of ⑤'s header) contains `XAI-3A-4516` at columns D, E, F
- **THEN** the emitted option `ホワイト` carries `productCode: "XAI-3A-4516"` AND the emitted option `ブラック` also carries `productCode: "XAI-3A-4516"` (no conflict warning since values match)

#### Scenario: Sub-label captured separately
- **WHEN** part ② sub-row contains `電球色` at columns D / E / F and `光無し` at column G
- **THEN** the emitted option `有` carries `subLabel: "電球色"` AND the alternative option `無` carries `subLabel: "光無し"`

#### Scenario: Conflicting product codes warned
- **WHEN** the same-label collapse for ⑥ ブラック spans columns E + F whose sub-row product codes are `BLK1` and `BLK2`
- **THEN** the emitted option `ブラック` carries `productCode: "BLK1"` AND a `label-collapse-product-code-conflict` warning is appended naming both codes

### Requirement: Archived legacy workbook preserved for reference
The archived workbook at `resources/catalog/old/部材リスト.xlsx` SHALL stay in the repository for human reference. The current `seed:parts` continues to support the legacy layout via auto-detection (see header-driven workbook column resolution requirement above), so contributors MAY still seed it for regression checks via `SPECDRAWING_WORKBOOK=resources/catalog/old/部材リスト.xlsx npm run seed:parts`.

When the customer migrates `レコリード` to the variant-keyed layout in a future workbook, the legacy fallback path remains available but is exercised only by the archived file.

#### Scenario: Archived legacy workbook still seedable
- **WHEN** `SPECDRAWING_WORKBOOK=resources/catalog/old/部材リスト.xlsx npm run seed:parts` is invoked
- **THEN** every sheet parses under the legacy layout
- **AND** every emitted option has `defaultForVariants: []`

## MODIFIED Requirements

### Requirement: Finish-option entry shape
Each finish-option entry MUST have a globally unique `id`, a `partId` that resolves to a known part in the active scene's parts manifest, a `sheet` value identifying which workbook sheet it came from (e.g. `"アーバンシー"` or `"レコリード"`), a Japanese `label`, an optional `productCode`, an optional `subLabel`, a `thumbnailUrl` for the swatch image, an `iconUrl` for the Excel spec-sheet export, and a `defaultForVariants: VariantKey[]` array. Each entry MUST set exactly one of `colorHex` (when its part's `renderMode` is `"color"`) or `textureUrl` (when its part's `renderMode` is `"texture"`).

#### Scenario: Color-mode option requires colorHex
- **WHEN** an option's `partId` resolves to a part with `renderMode: "color"` and the option omits `colorHex`
- **THEN** validation fails at load time with an error naming the option id

#### Scenario: Texture-mode option requires textureUrl
- **WHEN** an option's `partId` resolves to a part with `renderMode: "texture"` and the option omits `textureUrl`
- **THEN** validation fails at load time with an error naming the option id

#### Scenario: Setting both colorHex and textureUrl is rejected
- **WHEN** an option declares both `colorHex` and `textureUrl`
- **THEN** validation fails at load time with an error naming the option id

#### Scenario: Duplicate option id rejected
- **WHEN** two options share the same `id`
- **THEN** validation fails at load time with an error naming the duplicated id

#### Scenario: defaultForVariants defaults to empty array
- **WHEN** an option entry omits the `defaultForVariants` field
- **THEN** the loaded option's `defaultForVariants` is the empty array `[]`
