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
The seed pipeline (`scripts/extract-finish-options.mjs`) SHALL determine the variant column positions by reading row 0 of each sheet and locating cells whose values match the variant keys declared on the scene (case-insensitive). If the row 0 of a sheet does not contain at least the labels `Natural`, `Flat`, and `Sharp` (in any column), the seed step MUST exit non-zero with an error message naming the sheet and pointing at `resources/catalog/old/部材リスト.xlsx` as the legacy reference.

Columns to the right of the rightmost variant column whose row-0 cell is non-empty are treated as alternatives.

#### Scenario: Variant headers detected
- **WHEN** sheet `アーバンシー` row 0 contains `Natural` at column D, `Flat` at column E, `Sharp` at column F
- **THEN** the parser treats columns D / E / F as variant defaults and columns G+ as alternatives

#### Scenario: Missing variant headers fail visibly
- **WHEN** a sheet's row 0 is missing one or more variant headers
- **THEN** the seed step exits non-zero naming the sheet and the missing variant keys

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

### Requirement: Old workbook layout no longer parsed
The seed pipeline MUST NOT accept the legacy column layout (where every column under a part header is a sequential option). Detection is by absence of variant headers in row 0 (per the previous requirement). The archived workbook at `resources/catalog/old/部材リスト.xlsx` SHALL stay in the repository for human reference and MUST NOT be consumed by `seed:parts`.

#### Scenario: Legacy workbook seed attempt fails
- **WHEN** `SPECDRAWING_WORKBOOK=resources/catalog/old/部材リスト.xlsx npm run seed:parts` is invoked
- **THEN** the seed step exits non-zero naming the missing variant headers and pointing at the canonical workbook

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
