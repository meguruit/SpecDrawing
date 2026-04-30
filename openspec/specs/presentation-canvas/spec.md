# presentation-canvas Specification

## Purpose
TBD - created by archiving change add-material-presenter-mvp. Update Purpose after archive.
## Requirements
### Requirement: Base scene selection and loading
The canvas MUST load the active perspective from the `base-perspective-registry` capability. On app start, the registry's default scene MUST be loaded with no further user action; the loaded scene's `base.jpg` MUST become the bottom layer of the canvas, and the scene's parts MUST be exposed to the `numbered-part-overlay` and `color-composition` capabilities. The MVP's user-facing scene-picker UI is removed; the registry still supports multiple scenes for future expansion, but exactly one scene loads by default in this change.

#### Scenario: Default scene auto-loads
- **WHEN** the app starts
- **THEN** the canvas renders the default registered perspective's `base.jpg` as its bottom layer and exposes its parts to the overlay and composition capabilities

#### Scenario: Scene missing required asset fails visibly
- **WHEN** the active scene's `base.jpg` or its referenced `parts.json` is missing or invalid
- **THEN** the loader surfaces an error naming the scene and the missing/invalid file, and does not leave the canvas in a half-loaded state

### Requirement: Canvas state model
The canvas state MUST be held in a Zustand store and MUST include: the active scene id, the active option sheet (e.g. `"アーバンシー"` or `"レコリード"`), a per-part finish-selection map keyed by part id (`partFinishSelections: Record<PartId, FinishOptionId>`), the currently selected part id (or `null`), and the marker-overlay visibility flag. The store MUST NOT carry placed-material instances, axis filters, or per-part HEX color overrides — those concepts are removed from the model.

#### Scenario: State-driven rendering
- **WHEN** the store's `partFinishSelections` map changes for one part
- **THEN** the canvas re-renders only that part's finish layer; other parts' rendered finishes and the current `selectedPartId` are unchanged

#### Scenario: Sheet switch updates state per finish-spec-catalog rules
- **WHEN** the user switches `activeOptionSheet`
- **THEN** the store updates per the preservation/clearing rules defined in `finish-spec-catalog`, and the canvas re-renders to match

#### Scenario: No legacy fields present
- **WHEN** the store is inspected
- **THEN** there is no `placedMaterials`, `axisFilters`, or `partColors` field on it

### Requirement: Client-only rendering boundary
All Konva rendering MUST live inside a single client component loaded via `next/dynamic` with `ssr: false`. Server-rendered pages MUST NOT reference Konva symbols. This requirement is unchanged from the MVP and re-stated here so the redesigned canvas re-asserts the SSR boundary.

#### Scenario: No SSR crash on initial load
- **WHEN** the `/` page is requested and rendered by the Next.js server
- **THEN** the response succeeds with no Konva-related import errors

### Requirement: Per-part finish-options panel
When a part is selected (via marker click, polygon click, or side list), the canvas UI MUST render a finish-options panel adjacent to the canvas listing the part's options for the active sheet. Each option MUST appear as a clickable chip showing the option's swatch thumbnail, label, and product code (when present). Clicking an option MUST update `partFinishSelections[partId]` to that option's id, and the canvas MUST re-render the part's finish layer accordingly.

#### Scenario: Panel renders on part selection
- **WHEN** the user selects part `10`
- **THEN** the panel lists every option from `finish-spec-catalog` for `(partId="10", sheet=activeSheet)`

#### Scenario: Choosing an option updates the canvas
- **WHEN** the user clicks the `"ｺｺﾅｯﾂﾁｪﾘｰ"` chip for part `10`
- **THEN** `partFinishSelections["10"]` is set to that option's id and part `10`'s finish layer re-renders to use that option

#### Scenario: Panel hides on deselection
- **WHEN** the user clicks the canvas background to clear the selection
- **THEN** the finish-options panel is hidden

### Requirement: Side list of parts
The UI MUST render a side list of all parts in the active scene, grouped by `category` in workbook order (e.g. `キッチン`, `照明`, `玄関`, `室内建具`, `床材`, `収納アクセント`, `サッシ`). Each row MUST show the part number, label, and the currently selected option's label (or "未選択" if none). Clicking a row MUST select that part identically to a marker click.

#### Scenario: Side list reflects selection
- **WHEN** the user selects part `15` via the canvas marker
- **THEN** the side list highlights the row for part `15`

#### Scenario: Side list shows current selection summary
- **WHEN** part `07` has option `"サンドベージュ"` selected
- **THEN** the side list row for part `07` shows `"サンドベージュ"` next to the part label

### Requirement: Sheet switcher
The UI MUST expose a control to switch between the workbook's option-set sheets (e.g. `"アーバンシー"` / `"レコリード"`). The control MUST reflect the current `activeOptionSheet` and MUST surface the notification produced by `finish-spec-catalog` when a switch causes selections to clear.

#### Scenario: Switching the sheet updates available options and surfaces clearing notice
- **WHEN** the user switches the sheet from `"アーバンシー"` to `"レコリード"` and one or more selections cannot be preserved
- **THEN** the affected selections are cleared, their finish layers are removed, and a non-blocking notification names the cleared parts

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

