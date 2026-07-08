## ADDED Requirements

### Requirement: Per-variant mask resolution
When a part declares `maskByVariant` (per `numbered-part-overlay`) and the selected option does NOT declare its own `mask` (see "Per-option mask override"), the runtime MUST resolve the mask image it composites against using the active variant key: it MUST use `part.maskByVariant[activeVariantKey]` when an entry exists for the active variant, and otherwise fall back to the part's base `mask`. This resolution mirrors the existing per-variant texture resolution (`textureUrlByVariant`) and applies identically to `renderMode: "color"` and `renderMode: "texture"` parts — the composite layer ordering (shading/texture → fill → mask `destination-in`, mask last) is unchanged; only which mask PNG is loaded changes.

The resolved mask URL MUST carry the part's `?v=<rev>` cache-bust query string. Because the resolved filename already differs per variant, switching variants MUST cause the runtime to request the variant's mask URL rather than re-serving the previously active variant's mask from the image cache.

When no variant is active (a sheet without `variantsEnabled`, or a scene with no variants), the runtime MUST use the base `mask`.

#### Scenario: Active variant with a per-variant mask uses it
- **WHEN** part `10` declares `maskByVariant: { "sharp": "mask_10__sharp.png" }` and the active variant is `sharp`
- **THEN** the runtime composites part `10` against `mask_10__sharp.png` (with its `?v=` query), not the base `mask`

#### Scenario: Active variant without a per-variant mask falls back to base mask
- **WHEN** part `10` declares `maskByVariant: { "sharp": "mask_10__sharp.png" }` and the active variant is `natural` (no entry)
- **THEN** the runtime composites part `10` against the base `mask` filename

#### Scenario: Switching variant swaps the composited mask
- **WHEN** part `10` has distinct masks for `natural` and `flat`, it is rendered under `natural`, and the user then switches to `flat`
- **THEN** the runtime re-renders part `10` against the `flat` mask without serving the `natural` mask from cache

#### Scenario: No active variant uses the base mask
- **WHEN** a scene has no variants (or the active sheet has `variantsEnabled: false`) and part `10` declares `maskByVariant`
- **THEN** the runtime composites part `10` against the base `mask`

### Requirement: Per-option mask override
When the selected finish option declares a `mask` (per `finish-spec-catalog`), the runtime MUST composite the part against that option mask instead of any part-level mask, **regardless of the active variant**. The full precedence for the mask a part is composited against is:

1. the selected option's `mask`, when present;
2. otherwise the part's `maskByVariant[activeVariantKey]`, when an entry exists for the active variant;
3. otherwise the part's base `mask`.

The option `mask` is a full web-root path used as-is (the runtime MUST NOT resolve it relative to the scene's asset directory the way it resolves `part.mask`). Its URL MUST carry the catalog cache-bust query (`?v=<optionsRev>`), the same revision used for the option's `textureUrl`. This precedence applies identically to `renderMode: "color"` and `renderMode: "texture"`, and the composite layer ordering (mask `destination-in` last) is unchanged — only which mask PNG is loaded changes. Runtime mask compositing requires nothing beyond this PNG; no per-option geometry is consulted.

#### Scenario: Option with a mask overrides the part mask on every variant
- **WHEN** part `14` is selected with option `14-urb-syn-ブラック2`, which declares `mask`, and the active variant is `natural`
- **THEN** the runtime composites part `14` against the option's `mask` (with its `?v=` query), not `part.maskByVariant["natural"]` nor the part's base `mask`

#### Scenario: Option without a mask falls back to part-level resolution
- **WHEN** part `14` is selected with option `14-urb-syn-ブラック`, which does NOT declare `mask`
- **THEN** the runtime resolves the mask via the part-level rule (`maskByVariant[active] ?? base mask`) exactly as for a part with no option-level override

#### Scenario: Option mask path is used verbatim
- **WHEN** an option declares `mask: "/assets/base/main/mask_14__sharp.png"`
- **THEN** the runtime loads that path directly (plus the `?v=<optionsRev>` query) without prepending the active scene's asset directory

### Requirement: Per-option mask disable
When the selected finish option declares the reserved sentinel `mask: "no"` (per `finish-spec-catalog`) AND the part's `renderMode` is `"texture"`, the runtime MUST disable mask compositing for that part: it MUST NOT load any mask PNG and MUST omit the trailing `destination-in` step, painting the option's texture PNG as-is. The texture MUST still be painted at its resolved `textureBox` when present, and full-scene otherwise; only the clip is removed.

The sentinel `"no"` outranks every path-based mask source (it is checked before `option.mask` is treated as a path, before `maskByVariant`, and before the base `mask`). It takes effect regardless of the active variant.

For a `renderMode: "color"` part, the runtime MUST ignore the `"no"` sentinel and resolve the mask from the part level (`maskByVariant[activeVariantKey] ?? base mask`) exactly as for an option without a `mask`. A color fill depends on the mask's `destination-in` to confine it to the part region, so disabling the mask is not offered for color-mode options and MUST NOT flood the whole scene with color.

#### Scenario: Texture option with `mask: "no"` paints unclipped
- **WHEN** a `renderMode: "texture"` part is selected with an option declaring `mask: "no"`
- **THEN** the runtime paints the option's texture PNG (at its `textureBox` if present, else full-scene) with no `destination-in` mask, and loads no mask PNG

#### Scenario: `mask: "no"` outranks per-variant and base masks on every variant
- **WHEN** a `renderMode: "texture"` part declares `maskByVariant` and base `mask`, is selected with an option declaring `mask: "no"`, and the active variant is `sharp`
- **THEN** the runtime still paints the texture unclipped, consulting neither `part.maskByVariant["sharp"]` nor the base `mask`

#### Scenario: `mask: "no"` is ignored for a color-mode part
- **WHEN** a `renderMode: "color"` part is selected with an option declaring `mask: "no"`
- **THEN** the runtime resolves the mask from the part level (`maskByVariant[active] ?? base mask`) and composites the color fill clipped by that mask, exactly as for an option without a `mask`
