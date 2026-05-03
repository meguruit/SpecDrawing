## ADDED Requirements

### Requirement: Per-sheet variants-enabled flag
The seed pipeline SHALL emit, alongside `finish-options.json`, a sheet-config map at `public/catalog/sheets.json` declaring which sheets enable runtime variant switching. The shape MUST be:

```
{ version: 1, sheets: Array<{ key: string, label: string, variantsEnabled: boolean, defaultVariantKey?: string }> }
```

When `variantsEnabled === true`, `defaultVariantKey` MUST be set and MUST match a `key` in the active scene's `scene.json` `variants` array. The `アーバンシー` sheet SHALL ship with `variantsEnabled: true` and `defaultVariantKey: "natural"`. Validation failure produces a loud, named error and blocks the finish-options UI from rendering.

#### Scenario: Sheets manifest loads and validates
- **WHEN** the app starts and `sheets.json` passes Zod validation
- **THEN** every sheet is enumerable with its `variantsEnabled` flag and `defaultVariantKey`

#### Scenario: Variants enabled without default variant key rejected
- **WHEN** a sheet declares `variantsEnabled: true` and omits `defaultVariantKey` (or `defaultVariantKey` does not match any scene variant)
- **THEN** validation fails at load time with an error naming the sheet key

### Requirement: Per-variant texture URL on texture-mode options
Every texture-mode option entry on a sheet whose `variantsEnabled === true` MUST carry a `textureUrlByVariant: Record<VariantKey, string>` map. The map MUST contain one entry for each `key` declared by the active scene's `scene.json` `variants` array. Each value MUST resolve to a file under `public/assets/finishes/<partId>/<optionId>__<variantKey>.png`.

The legacy `textureUrl` field MAY remain on options for back-compat with non-variant sheets, but on variant-enabled sheets the runtime SHALL ignore `textureUrl` and use `textureUrlByVariant[activeVariantKey]` instead.

The seed pipeline (`seed:variants`) SHALL be extended so that for every texture-mode option on a variant-enabled sheet it emits one masked PNG per declared variant key, written to the path above, regardless of whether `finish-base-overrides.json` lists the option.

#### Scenario: Texture option without textureUrlByVariant on variant-enabled sheet rejected
- **WHEN** an option has texture-mode resolution and lives on a sheet with `variantsEnabled === true` but omits `textureUrlByVariant`
- **THEN** validation fails at load time naming the option id

#### Scenario: textureUrlByVariant missing a declared variant key rejected
- **WHEN** the active scene declares variants `[natural, flat, sharp]` and an option's `textureUrlByVariant` omits `sharp`
- **THEN** validation fails at load time naming the option id and the missing variant key

#### Scenario: Variant PNG missing on disk fails visibly at seed time
- **WHEN** `seed:variants` runs and a `base_<variant>.jpg` declared by the scene is absent
- **THEN** an entry of `kind: "variant-missing"` is appended to `finish-options.warnings.json` naming the variant key AND every affected `(partId, optionId)`
- **AND** the seed step exits non-zero so the runtime does not attempt to load with a partial catalog

### Requirement: Icon URL on every option for spec-sheet export
Every finish-option entry MUST carry an `iconUrl: string` field that resolves to a file under `public/catalog/icons/<optionId>.png`. The seed pipeline SHALL extract icon images from the `部材リスト.xlsx` workbook (one per option) and emit them at this path. Icons SHALL be square PNGs at minimum 96 × 96 pixels suitable for embedding inside a spreadsheet cell.

`iconUrl` is a separate field from `thumbnailUrl`: `thumbnailUrl` is sized for the on-canvas swatch chip, `iconUrl` is sized for the Excel export.

#### Scenario: Option without iconUrl rejected
- **WHEN** any finish-option entry omits `iconUrl`
- **THEN** validation fails at load time naming the option id

#### Scenario: Icon file missing on disk fails at load
- **WHEN** an option's `iconUrl` resolves to a path that does not exist under `public/`
- **THEN** the loader surfaces an error naming the option id and the missing file

#### Scenario: Seed pipeline copies icons from the workbook
- **WHEN** `npm run seed:parts` runs against a 部材リスト.xlsx that contains icon images for every option
- **THEN** every emitted option has an `iconUrl` pointing at a corresponding file under `public/catalog/icons/`
