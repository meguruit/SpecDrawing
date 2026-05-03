## Why

Design walkthrough on `アーバンシー` revealed two classes of fidelity gaps that the variant-keyed seed pipeline can't fix on its own:

1. **Variant ↔ option-label mismatches.** The customer-prepared workbook puts wrong labels under `Natural / Flat / Sharp` for several parts. Today's seed parser trusts the workbook, so the runtime shows e.g. *ヘアラインシルバー* for `Natural` on ⑩ 玄関ドアパネル when the designer-decided correct mapping is *ココナッツチェリー*. Affected: ⑩, ⑪, ⑭ (column swaps / missing alternates).
2. **Alternative options render as flat color.** Parts with many wood-grain alternatives (⑩ 28 alts, ⑬ 9 alts, ⑮ 7 alts) currently fall back to the option's tiny swatch icon as the texture, which produces an unnatural flat fill on a region whose base finish has prominent grain. The designer wants alternatives to inherit the **luminance pattern** of a chosen "tint-base" finish (e.g., ⑩ alternatives tint ココナッツチェリー's wood grain with the alternative's icon color).
3. **Special-case rendering gaps.** ② キッチン間接照明 *無* doesn't visually erase the lighting bloom — it just leaves the option unselected. ⑰ サッシ枠's static `colorHex` values clash with `Sharp` and `Flat` base perspectives because the palette was picked against `Natural` only.

These are blockers for a customer demo. They are fixable with seed-pipeline + config changes without touching the runtime renderer (which already supports `textureUrlByVariant` per-option).

## What Changes

### 1. Variant-mapping override config

Add `resources/catalog/finish-variant-mapping.json` (designer-editable):

```json
{
  "version": 1,
  "overrides": {
    "10": { "natural": "ｺｺﾅｯﾂﾁｪﾘｰ", "flat": "ﾀﾞｰｼﾞﾘﾝｳｫﾙﾅｯﾄ", "sharp": "ｴｽﾌﾟﾚｯｿｳｯﾄﾞ" },
    "11": { "natural": "シルバー", "flat": "ゴールド", "sharp": "ブラック" },
    "13": { "natural": "ﾅﾁｭﾗﾙｸﾘｱ", "flat": "ｸﾞﾚｰｼﾞｭ", "sharp": "ｼｮｺﾗﾌﾞﾗｯｸ" },
    "14": { "natural": "シルバー", "flat": "シルバー", "sharp": "ブラック" }
  }
}
```

The seed step applies these overrides AFTER parsing the workbook, replacing each option's `defaultForVariants` so that exactly one option per variant key claims that variant. Options whose label appears as a key are promoted; previous claimants are demoted to alternatives (`defaultForVariants: []`).

For ⑭ specifically, `sharp: "ブラック"` references an option that doesn't exist on `アーバンシー` today. The seed step MUST either (a) synthesize the missing option by copying the same-label option from `レコリード`, or (b) emit a `missing-overridden-option` warning and leave the variant unclaimed.

### 2. Tint-base alternative rendering

Extend `resources/catalog/finish-base-overrides.json` (or add a sibling `finish-tint-base.json`) so each part can declare a tint-base finish:

```json
{
  "tintBase": {
    "10": { "label": "ｺｺﾅｯﾂﾁｪﾘｰ" },
    "13": { "label": "ｸﾞﾚｰｼﾞｭ" },
    "15": { "label": "ﾅﾗ樫" }
  }
}
```

`seed:variants` then, for every **alternative** option (`defaultForVariants: []`) on a part with `tintBase`:

1. Loads `<partId>/_v_<tintBase.variantKey>.png` (the masked variant base for the tint-base label) — the variant key is auto-derived from `defaultForVariants` of the named tint-base option.
2. Converts to monotone (linear luminance, `R = G = B = Y`).
3. Reads the option's `iconUrl` PNG, computes the dominant non-white sRGB color (drop pixels where `min(R,G,B) > 240`, take the mean of the rest).
4. Multiplies monotone × dominant color → produces a tinted PNG (RGB: tint, A: original mask alpha).
5. Writes one PNG per scene variant key (`<partId>/<optionId>__natural.png`, `__flat.png`, `__sharp.png`) — all three are byte-identical because the tint pattern is variant-invariant; we keep three copies so the runtime's per-variant texture lookup stays uniform.
6. Updates `option.textureUrlByVariant` to point at the tinted PNGs.

### 3. ② キッチン間接照明 *無* — ambient-fill texture

For the explicit *無* / *光無し* option on ②, generate a per-variant texture that erases the lighting bloom by sampling neighboring background:

1. For each variant base, extend the part's mask outward by a small dilation (e.g. 16 px), subtract the original mask → "neighborhood ring".
2. Compute the mean RGB of the variant base inside that ring.
3. Output a solid-RGB PNG sized to the part bbox, alpha = original mask alpha.
4. Wire it as the *無* option's `textureUrlByVariant[<each variant>]`.

Designer-controllable via a `noEffect` list in the variant-mapping config:

```json
{ "noEffect": [ { "partId": "02", "optionLabel": "無" } ] }
```

### 4. ⑰ サッシ枠 — `colorHexByVariant`

Extend the finish-option schema so color-mode options on a variant-enabled sheet MAY declare:

```json
"colorHexByVariant": { "natural": "#…", "flat": "#…", "sharp": "#…" }
```

When present, the runtime's color-mode compositing ([components/parts/PartFinishLayer.tsx:134-141](../../../components/parts/PartFinishLayer.tsx#L134-L141)) reads `colorHexByVariant[activeVariantKey]` instead of `colorHex`. When absent, the existing static `colorHex` is used (backwards compatible). Designer authors per-variant hex values in a new section of the variant-mapping config, sampling the variant base's background near the sash region as a guide (a one-shot helper script `scripts/suggest-sash-palette.mjs` outputs a starter palette that the designer can curate).

### 5. Title / icon / image consistency audit

Pure data-fix step: walk every option on `アーバンシー` for the 7 affected parts and verify `(label, iconUrl, dominant texture color)` are mutually consistent. Fix divergences in the workbook or via the variant-mapping config.

## Capabilities

### New Capabilities

(none — all changes extend existing capabilities)

### Modified Capabilities

- `finish-spec-catalog`: add `colorHexByVariant` to color-mode options; document `tintBase`, `variantOverrides`, and `noEffect` config-driven seed-pipeline rules.
- `presentation-canvas`: color-mode runtime now reads `colorHexByVariant[activeVariantKey]` when present and falls back to `colorHex`.

## Impact

- **Code**: `scripts/cut-base-variants.mjs` (tint-base loop, ambient-fill loop), `scripts/extract-finish-options.mjs` (apply variant overrides, optional cross-sheet synthesis for ⑭), `lib/finishes/schema.ts` (new optional fields), `lib/finishes/load.ts` (cross-validators), `components/parts/PartFinishLayer.tsx` (`colorHexByVariant` lookup).
- **Config**: `resources/catalog/finish-variant-mapping.json` (new), `resources/catalog/finish-base-overrides.json` (extended).
- **Assets**: regenerated `public/assets/finishes/<partId>/<optionId>__<variant>.png` for ⑩, ⑬, ⑮ alternatives; new ② *無* textures.
- **Runtime**: no breaking changes; all new fields are optional and gracefully degrade.
- **Out of scope**: changes to other parts (01–09 except 02, 12, 16); test-framework introduction (separate change); `レコリード` sheet (separate change).
