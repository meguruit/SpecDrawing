## ADDED Requirements

### Requirement: Active variant key in canvas state
The canvas state MUST include an `activeVariantKey: string | null` field. On app start, `activeVariantKey` MUST be set to the active sheet's default variant key when that sheet has `variantsEnabled === true`, and MUST be `null` otherwise. Switching the active sheet MUST recompute `activeVariantKey` against the new sheet's variant config.

#### Scenario: Default variant on first paint of a variant-enabled sheet
- **WHEN** the app starts with `activeOptionSheet = "アーバンシー"` and that sheet declares variants `[natural, flat, sharp]` with default `natural`
- **THEN** `activeVariantKey` is `"natural"`

#### Scenario: Variant key cleared when switching to a sheet without variants
- **WHEN** `activeVariantKey = "sharp"` and the user switches `activeOptionSheet` to a sheet whose `variantsEnabled === false`
- **THEN** `activeVariantKey` becomes `null` and any variant-switcher control is hidden

### Requirement: Variant switcher control
The UI MUST expose a variant-switcher control (a horizontal segmented control or button group) that is rendered ONLY when the active sheet has `variantsEnabled === true`. The control MUST list every variant declared by the active scene's `scene.json` `variants` array, MUST highlight the entry matching `activeVariantKey`, and MUST be reachable by both pointer and keyboard.

Selecting a variant entry MUST update `activeVariantKey` and trigger a single canvas re-render in which **only the base layer swaps to the chosen variant's `baseImageUrl`**. Selected texture-mode options keep their assigned `textureUrl` (set by the seed pipeline from `finish-base-overrides.json`), so a customer-picked option labelled "ﾁｬｲﾅ大理石(黒)" continues to paint its sharp-base crop even on the natural backdrop. Color-mode parts (accent cloth) are unaffected.

This decouples "room mood" (variant base) from "option appearance" (option texture): switching variants does NOT silently change which option is displayed for any selected part.

#### Scenario: Variant switcher visible only on variant-enabled sheet
- **WHEN** the active sheet has `variantsEnabled === true`
- **THEN** the variant switcher is rendered with one entry per variant
- **AND** when the user switches to a sheet with `variantsEnabled === false`, the variant switcher is removed from the DOM

#### Scenario: Switching variant swaps the base, preserves option textures
- **WHEN** the user has selected `ﾁｬｲﾅ大理石(黒)` for part `01` while `activeVariantKey === "natural"` and clicks `sharp`
- **THEN** the canvas backdrop swaps to `base_sharp.jpg`
- **AND** part `01`'s rendered finish continues to paint `option.textureUrl` (the sharp-base crop assigned by the override config) — no per-variant lookup, no re-fetch of the texture
- **AND** color-mode parts (accent cloth) keep the color the user picked, unchanged

#### Scenario: Switcher selection survives a sheet round-trip
- **WHEN** the user picks `flat`, switches to a sheet with `variantsEnabled === false`, then switches back to the variant-enabled sheet
- **THEN** `activeVariantKey` is restored to `"flat"` and the switcher highlights `flat`

### Requirement: Selected texture-mode options are variant-independent
For every texture-mode part with an active finish selection, the canvas MUST resolve the part's texture from `option.textureUrl` (and `option.textureBox`) regardless of `activeVariantKey`. The runtime MUST NOT consult `option.textureUrlByVariant` when rendering a selected option. Color-mode parts MUST continue to use their current `colorHex`-based composition path.

`textureUrlByVariant` MAY remain on option entries as designer-side metadata (the seed pipeline populates it for variant-enabled sheets) but the runtime SHALL ignore it for canvas rendering. Customers see the same option overlay across every variant; only the unselected base shows variant differences.

#### Scenario: Selected option texture does not change with variant
- **WHEN** `activeVariantKey` changes from `"natural"` to `"sharp"` and part `01` has option `ﾁｬｲﾅ大理石(白)` selected
- **THEN** the network does NOT issue a new request for part `01`'s texture
- **AND** the canvas re-renders with the same `option.textureUrl` overlaid on the new base

#### Scenario: Color-mode part unaffected
- **WHEN** `activeVariantKey` changes and the kitchen accent cloth part has a `colorHex` selection
- **THEN** the accent cloth's color overlay is re-rendered with the same `colorHex` value over the new base image
