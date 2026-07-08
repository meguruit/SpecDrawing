## MODIFIED Requirements

### Requirement: Canvas state model
The canvas state MUST be held in a Zustand store and MUST include: the active scene id, the active option sheet (e.g. `"アーバンシー"` or `"レコリード"`), a per-part finish-selection map keyed by part id (`partFinishSelections: Record<PartId, FinishOptionId>`), a per-part per-sheet default map (`partSheetDefaults: Record<PartId, Record<SheetName, { default: FinishOptionId; byBase: Record<VariantKey, FinishOptionId> }>>`, resolved from `default-options.json` per `finish-spec-catalog`; empty when the file is absent), the currently selected part id (or `null`), and the marker-overlay visibility flag. The store MUST NOT carry placed-material instances, axis filters, or per-part HEX color overrides — those concepts are removed from the model.

On scene load the store MUST seed `partFinishSelections[partId]` from the part's **effective default** for the initial sheet and initial active base (the base override when the active base has one, otherwise `default`) for every part that has a default configured for the initial sheet; parts without a default for that sheet MUST start unselected.

#### Scenario: State-driven rendering
- **WHEN** the store's `partFinishSelections` map changes for one part
- **THEN** the canvas re-renders only that part's finish layer; other parts' rendered finishes and the current `selectedPartId` are unchanged

#### Scenario: Defaults seed the initial selection map
- **WHEN** a scene loads and `partSheetDefaults` declares a default for part `03` on the initial sheet
- **THEN** `partFinishSelections["03"]` is seeded to that default option id before any user interaction, while a part with no default for the initial sheet has no entry in `partFinishSelections`

#### Scenario: Sheet switch updates state per finish-spec-catalog rules
- **WHEN** the user switches `activeOptionSheet`
- **THEN** the store updates per the preservation/default-following/clearing rules defined in `finish-spec-catalog`, and the canvas re-renders to match

#### Scenario: No legacy fields present
- **WHEN** the store is inspected
- **THEN** there is no `placedMaterials`, `axisFilters`, or `partColors` field on it

### Requirement: Per-part finish-options panel
When a part is selected (via marker click, polygon click, or side list), the canvas UI MUST render a finish-options panel adjacent to the canvas listing the part's options for the active sheet. Each option MUST appear as a clickable chip showing the option's swatch thumbnail, label, and product code (when present). Clicking an option MUST update `partFinishSelections[partId]` to that option's id, and the canvas MUST re-render the part's finish layer accordingly.

The panel MUST expose a "クリア" (clear) control whose behavior depends on whether the part has an effective default for the active sheet and active base (`resolveSheetDefault(partSheetDefaults[partId]?.[activeSheet], activeBase)`):
- When the part has an effective default, クリア MUST be shown **only while the current selection differs from that effective default**, and pressing it MUST set the selection back to the effective default (never to unselected).
- When the part has no default, クリア MUST be shown whenever the part has any selection, and pressing it MUST remove the selection (return the part to 未選択), as before.

#### Scenario: Panel renders on part selection
- **WHEN** the user selects part `10`
- **THEN** the panel lists every option from `finish-spec-catalog` for `(partId="10", sheet=activeSheet)`

#### Scenario: Choosing an option updates the canvas
- **WHEN** the user clicks the `"ｺｺﾅｯﾂﾁｪﾘｰ"` chip for part `10`
- **THEN** `partFinishSelections["10"]` is set to that option's id and part `10`'s finish layer re-renders to use that option

#### Scenario: Defaulted part hides クリア until a non-default is chosen
- **WHEN** part `03` is showing its active-sheet default
- **THEN** the クリア control is not rendered; and **WHEN** the user then picks a different option for part `03`, the クリア control appears

#### Scenario: クリア on a defaulted part restores the default
- **WHEN** part `03` has a non-default option selected and the user presses クリア
- **THEN** `partFinishSelections["03"]` is set back to the active sheet's default option id (part `03` is not left unselected)

#### Scenario: クリア on a non-defaulted part removes the selection
- **WHEN** a part with no configured default has a selection and the user presses クリア
- **THEN** `partFinishSelections[partId]` is removed and the part returns to 未選択

#### Scenario: Panel hides on deselection
- **WHEN** the user clicks the canvas background to clear the selection
- **THEN** the finish-options panel is hidden
