## ADDED Requirements

### Requirement: The white perspective is the shading source

Zone colour SHALL be composited over the uploaded white perspective with a multiply blend, so that the lighting contrast already baked into the perspective — surface shading, cast shadows, ambient occlusion — carries through into the coloured result. The system MUST NOT require, generate, or consume a separate shading map for exterior zones.

#### Scenario: Baked shading survives colouring

- **WHEN** a zone spans a wall that is bright in sunlight and dark beneath a canopy, and a mid-value colour is applied
- **THEN** the sunlit part renders as the colour and the shadowed part renders as a darker rendition of the same colour

#### Scenario: No shading asset is required

- **WHEN** a zone is coloured
- **THEN** no shading image is requested, generated, or written for that zone

#### Scenario: Hue rotation is not used

- **WHEN** a colour is applied to a zone
- **THEN** the composition uses a multiply blend and not a hue-rotation filter

### Requirement: Per-zone opacity

Each zone SHALL carry its own opacity value in the range 0 to 1, applied to that zone's colour layer, and adjustable from the UI through both a slider and a numeric readout. A newly created zone MUST start at the default opacity of 0.85. Changing a zone's opacity MUST re-render that zone immediately and MUST NOT affect any other zone.

#### Scenario: New zone starts at the default opacity

- **WHEN** the user creates a zone and assigns it a colour
- **THEN** the zone's opacity reads 0.85

#### Scenario: Lowering opacity shows more of the base

- **WHEN** the user drags a zone's opacity from 0.85 toward 0
- **THEN** the zone's rendering progressively approaches the untouched base image, reaching it at 0

#### Scenario: Opacity is per zone

- **WHEN** the user changes one zone's opacity
- **THEN** every other zone renders exactly as before

### Requirement: Zone composition order

Within a zone, the composition SHALL proceed in this order: the colour fill first, then the finish texture when enabled, then the clipping step **last**. The clipping step MUST be applied after all painting so that no colour bleeds outside the zone's polygons.

#### Scenario: No bleed outside the zone

- **WHEN** a zone with an assigned colour is rendered over the base image
- **THEN** no pixel outside that zone's polygons differs from what it would be with the zone absent

#### Scenario: Clipping is applied last

- **WHEN** a zone has both a colour and the finish texture enabled
- **THEN** the texture is applied over the colour and the combined result is clipped once, at the end

### Requirement: Zone clipping honours holes

Clipping SHALL treat a zone's hole rings as excluded regions using an even-odd fill rule, so that the interior of a hole ring is not painted while the region between the outer ring and the hole is.

#### Scenario: Hole interior stays untouched

- **WHEN** a zone has an outer ring covering a wall and a hole ring around a window
- **THEN** pixels inside the hole ring are identical to the base image and pixels between the rings carry the zone's colour

#### Scenario: Multiple holes are all excluded

- **WHEN** a zone has three hole rings
- **THEN** all three interiors remain unpainted

### Requirement: Zone isolation during composition

A zone's clipping step MUST NOT erase or alter the rendered result of any other zone or of the base image. Overlapping zones MUST both render, with the later zone in the stacking order drawn over the earlier.

#### Scenario: Clipping does not erase siblings

- **WHEN** three zones with assigned colours are rendered and one of them is clipped
- **THEN** the other two zones and the base image remain fully rendered

#### Scenario: Overlap resolves by stacking order

- **WHEN** two coloured zones overlap
- **THEN** the overlapping region shows the colour of the zone later in the stacking order

### Requirement: Finish texture overlay

A zone SHALL optionally carry a finish texture. When enabled, the normalized sandstone texture MUST be tiled across the zone and composited over the zone's colour with a blend that modulates surface grain without shifting the colour's overall value. Toggling the texture MUST re-render only that zone.

#### Scenario: Texture adds grain without shifting colour

- **WHEN** the user enables the finish texture on a zone with an assigned colour
- **THEN** the zone gains visible surface grain while its overall colour value stays materially the same

#### Scenario: Texture is per zone

- **WHEN** one zone has the finish texture enabled and an adjacent zone does not
- **THEN** only the first zone shows grain

#### Scenario: Texture is clipped to the zone

- **WHEN** the finish texture is enabled on a zone
- **THEN** the tiled texture appears only inside that zone's polygons

### Requirement: Editing affordances render above zone fills

Vertex handles, ring outlines, and the selected-zone highlight MUST be drawn above all zone fills so they remain visible over dark colours. These affordances MUST be excluded from any exported image.

#### Scenario: Handles visible over a dark zone

- **WHEN** a zone is filled with a dark colour and selected
- **THEN** its vertex handles and outline are visible over the fill

#### Scenario: Affordances excluded from export

- **WHEN** a zone is selected with visible handles at the moment of export
- **THEN** the exported image contains no handles, outlines, or selection highlight

### Requirement: Unassigned zones render nothing

A zone with no colour assigned MUST NOT alter the base image. It MUST still be selectable and editable, and its outline MUST still be drawn as an editing affordance when appropriate.

#### Scenario: Unassigned zone leaves the base intact

- **WHEN** a zone has vertices but no assigned colour
- **THEN** the pixels within it are identical to the base image

#### Scenario: Unassigned zone is still selectable

- **WHEN** the user clicks inside an unassigned zone
- **THEN** the zone becomes selected and its vertex handles appear

### Requirement: Clearing a zone's colour restores the base

Clearing a zone's assigned colour MUST return that zone's pixels to the untouched base image while preserving the zone's geometry, label, opacity, and finish-texture flag.

#### Scenario: Cleared colour restores base pixels

- **WHEN** the user clears the colour of a coloured zone
- **THEN** that region shows the base image again and the zone's polygons, label, opacity, and texture flag are unchanged
