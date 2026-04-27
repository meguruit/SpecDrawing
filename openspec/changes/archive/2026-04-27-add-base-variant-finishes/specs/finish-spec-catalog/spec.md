## ADDED Requirements

### Requirement: Per-option base-variant override config
The seed pipeline SHALL accept a designer-editable override config at `resources/catalog/finish-base-overrides.json` with shape `{ version: 1, overrides: { [partId]: { [optionLabel]: variantKey } } }`. Each entry maps a `(partId, optionLabel)` pair to the variant base perspective key (`natural` | `sharp` | `flat` | extensible) whose corresponding region should be cropped and used as the option's `textureUrl`.

The override applies uniformly across all sheets — if multiple sheets contain an option with the same `(partId, label)`, every matching option entry receives the same cropped texture. Options not listed in the override config keep their previous behavior (workbook swatch or color-mode).

#### Scenario: Override resolves to the variant base for matching options
- **WHEN** the override config maps `01 → ﾁｬｲﾅ大理石(黒) → sharp` and the seed pipeline runs
- **THEN** every option with `partId = "01"` and `label = "ﾁｬｲﾅ大理石(黒)"` (across all sheets) gets its `textureUrl` rewritten to the path of the cropped piece taken from `base_sharp.jpg`

#### Scenario: Unmatched override label emits a warning
- **WHEN** the override config references a `(partId, optionLabel)` that does not exist in `finish-options.json` (e.g., the workbook label was changed)
- **THEN** an entry of `kind: "no-matching-option"` is appended to `finish-options.warnings.json` naming the override
- **AND** no `textureUrl` is rewritten

### Requirement: Variant-cutting seed step
The pipeline SHALL provide an `npm run seed:variants` command (script `scripts/cut-base-variants.mjs`) that, for every override entry whose variant base file exists, loads the variant base, masks it by the part's `mask_<id>.png`, writes the cropped result as a PNG to the option's `textureUrl` path under `public/assets/finishes/<partId>/<optionId>.png`, and updates `public/catalog/finish-options.json` so the option entries reference the new path.

The script MUST be idempotent: re-running with unchanged inputs produces unchanged outputs. The script MUST run independently of `seed:parts` and `seed:masks` so a designer can re-cut variants without re-extracting the workbook or regenerating masks.

#### Scenario: Successful cut writes a scene-resolution PNG
- **WHEN** `npm run seed:variants` runs against an override that has a matching variant base
- **THEN** the option's `textureUrl` resolves to a scene-resolution PNG whose RGB equals the variant base's RGB, with alpha equal to the part's mask alpha

#### Scenario: Idempotent re-run
- **WHEN** `npm run seed:variants` runs twice in succession with no input changes
- **THEN** the second run produces output PNGs and a `finish-options.json` byte-identical to the first run's

### Requirement: Missing-variant fallback
When a variant base file referenced by the override config is absent, the seed step MUST emit an entry of `kind: "variant-missing"` to `finish-options.warnings.json` (naming the variant key, the part id, and the option label) and MUST leave the option's existing `textureUrl` unchanged. The runtime continues to render whatever the option's `textureUrl` previously pointed at (typically the workbook swatch from `seed:parts`).

#### Scenario: Missing variant logs a warning, app stays usable
- **WHEN** the override config references variant `sharp` but `resources/base/ベースパース_sharp.jpg` does not exist
- **THEN** the seed step emits a `variant-missing` warning naming `sharp` and every affected `(partId, optionLabel)`
- **AND** the option's `textureUrl` retains its prior value
- **AND** the runtime continues to render the option (with the previous workbook swatch) without an error

#### Scenario: Adding the missing variant later activates the cuts
- **WHEN** the customer drops `ベースパース_sharp.jpg` into `resources/base/` and `npm run seed:variants` is rerun
- **THEN** the previously-missing entries are removed from the warnings file
- **AND** the affected options' `textureUrl` are rewritten to point at the new cropped PNGs

### Requirement: Catalog revision for cache-bust
`loadFinishOptions` SHALL return, alongside the option array, a string `_rev` derived from the catalog's content (e.g. an FNV-1a 32-bit hash of the JSON body). The runtime SHALL append `?v=<_rev>` to every option `textureUrl` it hands to `useImage`, so re-running `seed:variants` (which overwrites texture PNG content at the same URL) produces a new URL on the next reload of `/` and the browser refetches the latest crop.

This mirrors the per-part `_rev` cache-bust on mask + shading URLs introduced for `/dev/trace` (see `dev-trace-tool` capability D13).

#### Scenario: Texture URLs carry a catalog-rev cache-bust
- **WHEN** the runtime loads a finish option with a `textureUrl`
- **THEN** the actual fetch URL is `<textureUrl>?v=<rev>` where `<rev>` is the catalog content hash

#### Scenario: Re-running seed:variants invalidates texture URLs
- **WHEN** `seed:variants` rewrites several option textureUrls and the catalog file is re-saved
- **THEN** on the next reload of `/`, the new texture URLs use a different `?v=` query than before
