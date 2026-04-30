## ADDED Requirements

### Requirement: Per-variant colorHex on color-mode options
Color-mode finish options on a variant-enabled sheet MAY declare an optional `colorHexByVariant: { [variantKey]: "#RRGGBB" }` map alongside the existing `colorHex`. Every key in the map MUST match a `key` declared on the active scene's `variants[]` array; values MUST match `^#[0-9A-Fa-f]{6}$`. The map MAY be partial — variants not listed fall back to the static `colorHex`.

The map MUST NOT be set on texture-mode options; validation MUST reject the field there.

#### Scenario: Sash option declares per-variant colorHex
- **WHEN** option `17-urb-2-opt2` (プラチナステン) ships with `colorHex: "#9C8F81"` and `colorHexByVariant: { "natural": "#9C8F81", "flat": "#A39685", "sharp": "#80776B" }`
- **THEN** the catalog validates and the option carries both fields

#### Scenario: Partial colorHexByVariant inherits static colorHex
- **WHEN** an option declares only `colorHexByVariant: { "sharp": "#…" }` and a static `colorHex: "#…"`
- **THEN** validation passes; on `Natural` and `Flat`, the runtime resolves the static `colorHex`; on `Sharp`, the runtime resolves the per-variant override

#### Scenario: Unknown variant key in colorHexByVariant rejected
- **WHEN** `colorHexByVariant` contains a key (e.g. `"matte"`) not declared on the active scene's `variants[]`
- **THEN** validation fails at load time naming the option id and the unknown variant key

#### Scenario: Texture-mode option declaring colorHexByVariant rejected
- **WHEN** a texture-mode option declares `colorHexByVariant`
- **THEN** validation fails at load time naming the option id

### Requirement: Variant-mapping override config
The seed pipeline SHALL accept a designer-editable override config at `resources/catalog/finish-variant-mapping.json` with shape:

```ts
{
  version: 1,
  overrides?: {
    [partId: string]: { [variantKey: string]: optionLabel }
  },
  noEffect?: {
    partId: string;
    optionLabel: string;
    dilate?: number;     // 1..256, default 16: ring distance (px) outside mask
    dim?: number;        // 0..2, default 1: brightness multiplier on sampled ring
    targetHex?: string;  // "#RRGGBB": override ring sample with hand-picked color
  }[],
  colorHexByVariant?: {
    [partId: string]: {
      [optionLabel: string]: { [variantKey: string]: "#RRGGBB" }
    }
  }
}
```

`overrides` re-assigns `defaultForVariants` on emitted options so that exactly one option per declared variant key claims that key. The named option becomes the variant's default; previously-claimant options on the same `(partId, sheet)` are demoted (the variant key is removed from their `defaultForVariants`).

When an `overrides` entry references an option label that does NOT exist on the active scene's primary sheet, the seed step MUST attempt cross-sheet synthesis: search the same `partId` on every other emitted sheet for a matching label; if found, copy that option (preserving `productCode`, `iconUrl`, `subLabel`, and other workbook-derived fields) and tag the synthesized option `synthesized: true`. If no match exists across all sheets, the seed step MUST append a `missing-overridden-option` warning entry naming `(partId, variantKey, optionLabel)` to `finish-options.warnings.json` and leave the variant unclaimed.

`noEffect` and `colorHexByVariant` blocks are applied as the rules in their dedicated requirements describe.

#### Scenario: Override re-assigns variant claimant
- **WHEN** the workbook emits ⑩ with `defaultForVariants: { ﾍｱﾗｲﾝｼﾙﾊﾞｰ:["natural"], ｱｲﾎﾞﾘｰ:["flat"], ｺｺﾅｯﾂﾁｪﾘｰ:["sharp"] }` AND the override declares `"10": { natural: "ｺｺﾅｯﾂﾁｪﾘｰ", flat: "ﾀﾞｰｼﾞﾘﾝｳｫﾙﾅｯﾄ", sharp: "ｴｽﾌﾟﾚｯｿｳｯﾄﾞ" }`
- **THEN** the emitted catalog has `ｺｺﾅｯﾂﾁｪﾘｰ.defaultForVariants = ["natural"]`, `ﾀﾞｰｼﾞﾘﾝｳｫﾙﾅｯﾄ = ["flat"]`, `ｴｽﾌﾟﾚｯｿｳｯﾄﾞ = ["sharp"]`, AND `ﾍｱﾗｲﾝｼﾙﾊﾞｰ = []`, `ｱｲﾎﾞﾘｰ = []`

#### Scenario: Cross-sheet synthesis for missing option
- **WHEN** the override declares `"14": { sharp: "ブラック" }` AND `アーバンシー` ⑭ has only `シルバー` AND `レコリード` ⑭ has `ブラック`
- **THEN** the seed step copies `レコリード`'s ⑭ ブラック option into `アーバンシー` ⑭ tagged `synthesized: true`, then claims `defaultForVariants: ["sharp"]` on it

#### Scenario: Missing-overridden-option warning
- **WHEN** an override references an option label that exists on no sheet for the partId
- **THEN** a `missing-overridden-option` warning naming `(partId, variantKey, optionLabel)` is appended to `finish-options.warnings.json` AND the variant remains unclaimed by any option

#### Scenario: Same-label collapse via override
- **WHEN** the override declares `"14": { natural: "シルバー", flat: "シルバー", sharp: "ブラック" }`
- **THEN** `シルバー.defaultForVariants = ["natural", "flat"]` and `ブラック.defaultForVariants = ["sharp"]` (same-label collapse rule already in finish-spec-catalog applies)

### Requirement: Tint-base alternative texture generation
The seed pipeline SHALL accept a `tintBase` block in `resources/catalog/finish-base-overrides.json`:

```ts
{
  ...,
  tintBase?: {
    [partId: string]: {
      label?: string;   // OPTIONAL: omit on color-mode parts (e.g. ⑰ サッシ枠)
      lift?: number;    // 0..1, default 0
    }
  }
}
```

`label` is OPTIONAL. When present, the named option's masked variant crop is used as the luminance source for tinting alternatives on the part (texture-mode behavior). When ABSENT, the entry is treated as a color-mode lift directive: `seed:variants` lifts the part's `shading_<id>.png` file in-place by the `lift` factor, suppressing dark shading bands so light `colorHex` values do not read as gray (e.g. ⑰ サッシ枠 with light fill colors).

`lift` ranges 0 (pure multiply, full grain contrast) to 1 (no shading at all). Applied as `Y' = Y + (1 − Y) * lift` before the multiply for texture-mode tinting, or directly to `shading_<id>.png` for color-mode parts.

When `tintBase[partId]` is set with a `label`, `seed:variants` SHALL, for every alternative option (`defaultForVariants: []`) on that part:

1. Resolve the tint-base option by `(partId, label)` and read its `defaultForVariants` to derive the tint-base variant key. The tint-base option MUST have exactly one variant in `defaultForVariants`; otherwise emit a `tint-base-ambiguous-variant` warning and skip the part.
2. Load `<partId>/_v_<tintBaseVariantKey>.png` and convert RGB to monotone luminance (`Y = 0.2126·R + 0.7152·G + 0.0722·B`), then apply the `lift` factor.
3. Compute the dominant non-white color of the alternative's `iconUrl` PNG: drop pixels where `min(R, G, B) > 240`, take the channel-wise mean of the rest. If fewer than 5% of pixels remain, emit a `tint-color-low-confidence` warning.
4. Multiply monotone × dominant color, retain the original mask alpha, and write three byte-identical PNGs `<partId>/<optionId>__natural.png`, `__flat.png`, `__sharp.png` (one per scene variant key).
5. Set `option.textureUrlByVariant[v] = { url: "/assets/finishes/<partId>/<optionId>__<v>.png", textureBox: <bbox> }` for every variant `v` declared on the scene.

When `tintBase[partId]` is set WITHOUT a `label` (color-mode part), `seed:variants` SHALL instead lift the part's `public/assets/finishes/<partId>/shading_<id>.png` file in-place using `Y' = Y + (1 − Y) * lift`.

Re-running `seed:variants` with unchanged inputs MUST produce byte-identical tinted PNGs (texture-mode) or byte-identical lifted shading files (color-mode).

#### Scenario: Tint-base produces grain-following alternative
- **WHEN** ⑩'s `tintBase = { label: "ｺｺﾅｯﾂﾁｪﾘｰ" }` AND ⑩ has alternative option `ｶﾞﾅｯｼｭｳｫｰﾙﾅｯﾄ` with iconUrl pointing at a brown-gray swatch
- **THEN** `seed:variants` emits `10/<gnasshu-id>__natural.png` whose pixels are the ココナッツチェリー luminance pattern multiplied by the brown-gray dominant icon color, AND the option's `textureUrlByVariant["natural"].url` resolves to that file

#### Scenario: Tint-base option with multi-variant default skipped
- **WHEN** `tintBase = { label: "X" }` AND option `X` has `defaultForVariants: ["natural", "flat"]`
- **THEN** a `tint-base-ambiguous-variant` warning is appended AND no tint output is emitted for that part

### Requirement: Ambient-fill texture for noEffect options
For each entry in `finish-variant-mapping.json`'s `noEffect` array, `seed:variants` SHALL generate a per-variant solid-fill texture that erases the visual effect of the part. Each entry MAY tune its sample with three optional fields: `dilate` (1..256, default 16) sets the ring distance in px, `dim` (0..2, default 1) is a brightness multiplier applied to the sampled color, and `targetHex` (`#RRGGBB`) replaces the sampled color entirely with a hand-picked value.

For each entry:

1. For each variant base, dilate the part's mask outward by `dilate` px (default 16; using sharp's `convolve` or equivalent), subtract the original mask → "neighborhood ring".
2. Compute the mean RGB inside the ring on that variant base. If `targetHex` is set, use that color instead of the sampled mean.
3. Multiply the resulting RGB by `dim` (default 1).
4. Emit a solid-RGB PNG sized to the part bbox, alpha = original mask alpha.
5. Wire as `option.textureUrlByVariant[<variant>]` for every variant declared on the scene.

The output filename follows the same `<partId>/<optionId>__<variant>.png` pattern.

#### Scenario: ② 無 erases indirect-lighting bloom
- **WHEN** `noEffect: [{ partId: "02", optionLabel: "無" }]` AND the user picks ② 無 on `アーバンシー` Natural
- **THEN** the ② region renders the mean ceiling color from a 16-px-wide ring around the lighting strip on `base_natural.jpg`, visually erasing the lighting bloom

#### Scenario: noEffect entry pointing at non-existent option warned
- **WHEN** a `noEffect` entry references a `(partId, optionLabel)` not present in the emitted catalog
- **THEN** a `missing-no-effect-option` warning is appended and no texture is emitted
