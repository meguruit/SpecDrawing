## ADDED Requirements

### Requirement: Numbered-part manifest per scene
Each registered base perspective MUST be accompanied by a numbered-part manifest at `public/assets/base/<scene-id>/parts.json`, validated against a Zod schema at load time. The manifest SHALL enumerate every changeable region of the perspective as a part record containing: a stable string id (zero-padded, e.g. `"01"` … `"17"`), a Japanese label, a category, the source-PDF reference (1, 2, or 3, matching `部材対応番号-<n>.pdf`), the marker centroid in scene-pixel coordinates, a polygon (ordered list of `[x, y]` vertices in scene-pixel coordinates) for hit-testing, the declared render mode (`"color"` or `"texture"`), and the mask filename relative to the scene directory. Color-mode parts MUST additionally declare a shading filename.

#### Scenario: Parts manifest loads and validates
- **WHEN** a scene is loaded and its `parts.json` passes Zod validation
- **THEN** every part is available to the canvas overlay and to the `finish-spec-catalog` lookup

#### Scenario: Color-mode part missing shading rejected
- **WHEN** a part declares `renderMode: "color"` but omits the `shading` field
- **THEN** validation fails at load time with an error naming the offending part id

#### Scenario: Mask asset missing fails visibly
- **WHEN** a part declares `mask: "mask_07.png"` but the file is absent under the scene directory
- **THEN** the loader surfaces an error naming the scene, the part id, and the missing file

### Requirement: Marker rendering and hit-testing
For each part in the active scene's manifest, the canvas MUST render a numbered marker (a circular badge containing the part number) anchored at the part's `marker` coordinates above the base image. Clicking inside the part's `polygon` MUST select that part; clicking inside another part's polygon MUST switch the selection. Polygons MUST hit-test as point-in-polygon (not bounding-rect approximation) so non-rectangular regions (range hood, hanging shelves, accent cloth) are clickable accurately.

#### Scenario: Click inside polygon selects the part
- **WHEN** the user clicks inside the polygon of part `07`
- **THEN** `selectedPartId` becomes `"07"` and the finish-options panel for part `07` is shown

#### Scenario: Click on marker selects the part
- **WHEN** the user clicks the numbered marker for part `07`
- **THEN** the same selection occurs as for a polygon click

#### Scenario: Click outside any polygon clears selection
- **WHEN** the user clicks the canvas in an area not covered by any part polygon
- **THEN** `selectedPartId` becomes `null` and no finish-options panel is shown

### Requirement: Hover affordance
When the user hovers a part's polygon (or its marker), the canvas MUST render the polygon outline as a dashed overlay matching the color used for that part on the source `部材対応番号-*.pdf` (orange / blue / green / yellow per category). The outline MUST clear when the hover ends.

#### Scenario: Hover shows polygon outline
- **WHEN** the cursor enters the polygon of part `15`
- **THEN** the polygon's outline is rendered above the base image with a dashed stroke
- **AND** when the cursor leaves the polygon, the outline is removed

### Requirement: Number-overlay visibility toggle
The UI MUST expose a toggle that hides or shows all numbered markers and polygon outlines on the canvas. When markers are hidden, parts MUST still be selectable via the side list (provided by `presentation-canvas`). The toggle's default state MUST be "shown" on first app load.

#### Scenario: Toggle hides markers
- **WHEN** the user activates the "番号オーバーレイ" toggle to off
- **THEN** numbered markers and any active hover outlines are no longer rendered on the canvas
- **AND** the rendered finish layers continue to display

#### Scenario: Selection still works via side list when hidden
- **WHEN** markers are hidden and the user clicks part `15` in the side list
- **THEN** `selectedPartId` becomes `"15"` and the finish-options panel for part `15` is shown
