## MODIFIED Requirements

### Requirement: Color-mode compositing resolves per-variant colorHex
The color-mode compositing path in `PartFinishLayer` MUST resolve the fill color as `option.colorHexByVariant?.[activeVariantKey] ?? option.colorHex`. When `activeVariantKey` is `null` (non-variant sheet) or the option lacks a `colorHexByVariant` entry for the active variant, the static `colorHex` is used unchanged.

This rule applies after the existing shading-multiply step and before the mask alpha clip; the variant-aware lookup MUST NOT alter the order of the layered composition (shading → fill → mask).

#### Scenario: Color-mode option with full per-variant palette
- **WHEN** ⑰ プラチナステン declares `colorHex: "#9C8F81"` and `colorHexByVariant: { natural: "#9C8F81", flat: "#A39685", sharp: "#80776B" }` AND `activeVariantKey === "sharp"`
- **THEN** the rendered sash uses fill color `#80776B`

#### Scenario: Color-mode option with partial per-variant palette
- **WHEN** ⑰ ホワイト declares `colorHex: "#F7F2EC"` and `colorHexByVariant: { sharp: "#E8E2D8" }` AND `activeVariantKey === "natural"`
- **THEN** the rendered sash uses fill color `#F7F2EC` (static fallback)

#### Scenario: Color-mode option with no per-variant palette
- **WHEN** an option declares only `colorHex: "#…"` (no `colorHexByVariant`) AND `activeVariantKey` is any value
- **THEN** the rendered fill is the static `colorHex`, behavior unchanged from prior implementation
