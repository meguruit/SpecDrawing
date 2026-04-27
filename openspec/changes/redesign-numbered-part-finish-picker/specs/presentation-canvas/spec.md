## MODIFIED Requirements

### Requirement: Base scene loading from the registry
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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Placing materials from the catalog
**Reason**: Free-drop catalog placement is replaced by per-part finish selection on a registered perspective. There is no "place a material at a location" interaction in the new model.
**Migration**: Remove `MaterialsLayer.tsx` and the catalog → canvas placement bridge. User intent ("change this surface") is now expressed by selecting a numbered part and picking one of its finish options.

### Requirement: Material instance manipulation
**Reason**: There are no placed material instances to select, drag, or delete in the redesigned flow. Parts are fixed regions on the registered perspective.
**Migration**: Remove all selection / drag / delete handling tied to material instances. Selection in the new model is a single `selectedPartId`, not an instance id; there is no drag affordance, and the Delete key is not bound to canvas state.
