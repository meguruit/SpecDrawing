## ADDED Requirements

### Requirement: Seed extraction of the Jolypate colour catalog

A seed script SHALL derive `public/catalog/jolypate-colors.json` from `public/assets/jolypate/ジョリパカタログ 3.pdf`, exposed as an npm script (`seed:jolypate`). The extraction MUST read colour numbers from the PDF's text layer rather than by optical character recognition, and MUST be idempotent: re-running it on an unchanged PDF MUST produce byte-identical outputs.

#### Scenario: Seed produces the catalog

- **WHEN** the maintainer runs the Jolypate seed script against the committed catalog PDF
- **THEN** `public/catalog/jolypate-colors.json`, `public/catalog/jolypate-colors.warnings.json`, and one swatch PNG per emitted colour are written

#### Scenario: Re-running the seed is idempotent

- **WHEN** the seed script is run twice in a row with no change to the source PDF
- **THEN** the second run produces outputs byte-identical to the first

### Requirement: Only yellow-highlighted colour numbers are selectable

The catalog SHALL contain **only** those colours whose colour-number label in the PDF is rendered on a yellow highlight band. Colour numbers without a yellow band — the non-tintable and special-order entries such as `T6013`, `JP-100BK`, `JP-100SBK`, `JQ-200SBK`, `JQ-650SWH`, `T6401`, `T6405`, `T6404`, `T6010`, `T6702` — MUST NOT appear in `jolypate-colors.json` and MUST NOT be offered in the selection UI.

#### Scenario: Highlighted colour is included

- **WHEN** the seed processes the colour number `T1403`, whose label sits on a yellow band
- **THEN** `T1403` appears in `jolypate-colors.json`

#### Scenario: Non-highlighted colour is excluded

- **WHEN** the seed processes the colour number `JP-100BK`, whose label has no yellow band
- **THEN** `JP-100BK` does not appear in `jolypate-colors.json` and is not offered anywhere in the selection UI

#### Scenario: Exclusions are reported, not silent

- **WHEN** the seed excludes colour numbers for lack of a yellow band
- **THEN** every excluded colour number is listed in `jolypate-colors.warnings.json` under a distinct exclusion reason, and the run's summary reports how many were excluded

### Requirement: Catalog entry shape and validation

Each catalog entry MUST carry a colour number (`code`), a colour category (one of `NEUTRAL` / `MISTY` / `SUNNY` / `TRAD`), the source page, a representative colour as `#RRGGBB` (`colorHex`), and a swatch image URL (`swatchUrl`). A Japanese colour name (`nameJa`) MUST be carried when the source catalog provides one. The catalog file MUST be validated with a schema at load time; a file that fails validation MUST surface an error naming the offending entry and field, and MUST NOT be partially applied.

#### Scenario: Entry carries the required fields

- **WHEN** the loader reads an entry for `T3016`
- **THEN** the entry exposes `code`, `category`, `page`, `colorHex` matching `^#[0-9a-fA-F]{6}$`, and a `swatchUrl` that resolves to an existing image

#### Scenario: Malformed catalog fails loudly

- **WHEN** `jolypate-colors.json` contains an entry whose `colorHex` is not a 6-digit hex colour
- **THEN** the loader raises an error naming that entry's `code` and the `colorHex` field, and no colours are made available

#### Scenario: Traditional colour names are preserved

- **WHEN** the loader reads a `TRAD` category entry that the source catalog names 「白練 しろねり」
- **THEN** the entry's `nameJa` carries that name and the selection UI displays it alongside the colour number

### Requirement: Representative colour is sampled robustly from the swatch

The `colorHex` of an entry MUST be derived from the printed swatch area associated with that colour number, aggregated with a trimmed mean rather than a plain arithmetic mean, so that the aggregate colour of a granular, aggregate-bearing finish is not skewed by speckle outliers.

#### Scenario: Speckle does not skew the sampled colour

- **WHEN** the seed samples a swatch containing scattered light and dark aggregate specks
- **THEN** the emitted `colorHex` reflects the swatch's dominant field colour rather than being pulled toward the specks

#### Scenario: Low-confidence sampling is flagged

- **WHEN** a swatch area cannot be located for an otherwise highlighted colour number, or its sampled pixels are too few to aggregate reliably
- **THEN** the colour is reported in `jolypate-colors.warnings.json` with a low-confidence reason instead of being emitted with an unreliable `colorHex`

### Requirement: Extraction is self-verified against the catalog index

The seed MUST parse the catalog PDF's colour-number index page and use it as the ground-truth roster. Every extracted colour number MUST exist in the index. Index entries that were not extracted MUST be classified as either deliberately excluded (no yellow highlight) or as extraction failures. The run MUST print a summary of index-total, extracted, and excluded counts, and MUST exit non-zero when extracted plus excluded does not account for the full index.

#### Scenario: Extracted code absent from the index is an error

- **WHEN** extraction yields a colour number that does not appear on the index page
- **THEN** the run reports that colour number as unknown and exits non-zero

#### Scenario: Unaccounted index entries fail the run

- **WHEN** the index lists 148 colour numbers but extracted plus excluded accounts for only 140
- **THEN** the run reports the 8 unaccounted colour numbers by name and exits non-zero

#### Scenario: Fully accounted run succeeds

- **WHEN** every index colour number is either extracted or classified as excluded
- **THEN** the run prints the index-total, extracted, and excluded counts and exits zero

### Requirement: Designer override of extracted colour data

A designer-owned override file SHALL be able to correct extracted data per colour number, overriding the representative colour, the Japanese name, and whether the colour is included in the catalog at all. The override file MUST be optional: its absence MUST NOT fail the seed. Applied overrides MUST be listed in the run summary so a human can review what was overridden.

#### Scenario: Override corrects a sampled colour

- **WHEN** the override file sets a corrected `colorHex` for one colour number
- **THEN** the emitted catalog carries the corrected value and the run summary lists that colour number as overridden

#### Scenario: Missing override file is not an error

- **WHEN** no override file exists
- **THEN** the seed completes normally using purely extracted values

### Requirement: Colour selection panel

The exterior workspace SHALL present the Jolypate catalog in a side panel as clickable chips showing each colour's swatch, colour number, and Japanese name when present. Chips MUST be grouped by colour category, and the panel MUST offer a text filter that matches against the colour number and the Japanese name. Clicking a chip MUST assign that colour to the currently selected zone; with no zone selected, the panel MUST indicate that a zone must be selected first and MUST NOT change any zone.

#### Scenario: Panel groups by category

- **WHEN** the colour panel is open
- **THEN** chips appear under the `NEUTRAL`, `MISTY`, `SUNNY`, and `TRAD` groupings

#### Scenario: Filtering narrows the chips

- **WHEN** the user types `T30` into the panel's filter
- **THEN** only colour numbers containing `T30` remain visible

#### Scenario: Clicking a chip assigns the colour

- **WHEN** zone `外壁-南面` is selected and the user clicks the `T3016` chip
- **THEN** that zone's assigned colour becomes `T3016` and the canvas re-renders that zone

#### Scenario: Clicking with no zone selected changes nothing

- **WHEN** no zone is selected and the user clicks a colour chip
- **THEN** the panel indicates that a zone must be selected first and no zone's colour changes

### Requirement: Sandstone finish texture asset

The seed SHALL derive a tiling finish-texture asset from `public/assets/jolypate/ジョリパッド砂岩仕上.jpg`, normalized to greyscale with a mean luminance of 0.5 so that overlaying it modulates surface grain without shifting the underlying colour. The derived asset MUST be committed as a served asset, and the raw source JPG MUST remain unmodified.

#### Scenario: Derived texture is luminance-neutral

- **WHEN** the derived sandstone texture is inspected
- **THEN** it is greyscale with a mean luminance of 0.5, so a zone with the texture enabled and a flat colour keeps that colour's overall value

#### Scenario: Source asset is preserved

- **WHEN** the seed runs
- **THEN** `ジョリパッド砂岩仕上.jpg` is unchanged and the normalized texture is written to a separate path
