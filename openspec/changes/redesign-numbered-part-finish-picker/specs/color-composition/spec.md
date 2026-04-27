## MODIFIED Requirements

### Requirement: Per-part finish application
The system SHALL apply a chosen finish option to any part declared by the active scene's parts manifest. Each part declares a `renderMode` of either `"color"` or `"texture"`. Applying a finish MUST composite the chosen option onto the base image so the result visibly lands only on the part's masked region while preserving the base image's geometry; for `"color"` parts, the original lighting/shading MUST also be preserved.

For `renderMode: "color"`, applying an option MUST composite the option's `colorHex` onto the base image, masked by the part's `mask_<part>.png` alpha and modulated by the part's `shading_<part>.png` luminance — i.e. the same `mask × shading × color` pipeline introduced in the MVP.

For `renderMode: "texture"`, applying an option MUST composite the option's `textureUrl` image (a pre-rendered finish at scene resolution) onto the base image, clipped by the part's `mask_<part>.png` alpha. The texture image is assumed to already include lighting consistent with the base perspective; no shading multiply is applied in this mode.

#### Scenario: Color-mode option recolors only the masked region
- **WHEN** part `07` (renderMode `"color"`) has option `"サンドベージュ"` selected
- **THEN** pixels within `mask_07.png` alpha appear tinted toward the option's `colorHex` and pixels outside it are unchanged from `base.jpg`

#### Scenario: Color-mode shading is preserved
- **WHEN** a color-mode part's `shading_<part>.png` has darker regions representing shadow
- **THEN** the recolored output shows those regions darker than the base recolor, preserving the original lighting cues

#### Scenario: Texture-mode option swaps the masked region
- **WHEN** part `10` (renderMode `"texture"`) has option `"ｺｺﾅｯﾂﾁｪﾘｰ"` selected
- **THEN** pixels within `mask_10.png` alpha display the option's texture image and pixels outside it are unchanged from `base.jpg`

#### Scenario: Clearing a part's selection restores the base
- **WHEN** the user clears the finish selection for a part (or selects an explicit "no change" option backed by a transparent texture)
- **THEN** the canvas reverts that region to the unmodified `base.jpg` pixels

### Requirement: No hue-rotate fallback
The color composition pipeline MUST NOT use CSS `filter: hue-rotate` or any filter that changes hue without preserving luminance and saturation fidelity. Color application for `renderMode: "color"` MUST go through the mask + shading compositing path; texture application for `renderMode: "texture"` MUST go through the mask-clip compositing path.

#### Scenario: Implementation uses composite operations, not hue-rotate
- **WHEN** any finish is applied
- **THEN** the rendered output is produced by Konva composite operations on the part's mask plus (for color mode) shading plus (for color mode) a color rect or (for texture mode) a texture image, and not by a CSS hue-rotate filter

### Requirement: Scene-declared parts and render modes
The set of parts that can carry a finish, and each part's `renderMode`, are defined by the active scene's `parts.json` (per the `numbered-part-overlay` capability). The finish-options panel MUST only offer options whose `partId` matches a part declared by the active scene. Attempting to set a finish on a part not declared by the active scene MUST be rejected. Attempting to set a finish whose `colorHex`/`textureUrl` shape does not match its part's `renderMode` MUST also be rejected.

#### Scenario: UI lists only options for declared parts
- **WHEN** the active scene declares parts `["01", … "17"]` and the user selects part `07`
- **THEN** the panel only lists options whose `partId === "07"`

#### Scenario: Part-not-declared rejection
- **WHEN** a caller attempts to set a finish for a `partId` not present in the active scene's manifest
- **THEN** the store rejects the update and the canvas is unchanged

#### Scenario: Render-mode mismatch rejection
- **WHEN** a caller attempts to apply an option with `colorHex` set to a part whose `renderMode` is `"texture"` (or vice-versa)
- **THEN** the store rejects the update and the canvas is unchanged

### Requirement: Composite layer ordering
The bottom of the canvas MUST be the base scene image. Above it, each part with an active finish selection MUST render onto its **own dedicated canvas layer**, isolated from other parts.

For `renderMode: "color"` parts, within the part's layer the children draw in this order:

1. **Shading image** at full scene size (no compositing operator — it becomes the destination).
2. **Color fill rect** at full scene size with `globalCompositeOperation="multiply"`.
3. **Mask image** at full scene size with `globalCompositeOperation="destination-in"`.

The mask MUST be applied **last** within a color-mode part's layer. Performing the multiply after the mask leaks the shading image's RGB onto the alpha-0 regions outside the mask (Canvas2D `multiply` against a transparent destination yields opaque source pixels), producing gray smears. The "one part = one layer" isolation invariant from the MVP is preserved.

For `renderMode: "texture"` parts, within the part's layer the children draw in this order:

1. **Texture image** at full scene size (the option's `textureUrl`, no compositing operator).
2. **Mask image** at full scene size with `globalCompositeOperation="destination-in"`.

The mask MUST be applied **last** in this mode as well, for the same reason. Numbered markers and polygon outlines from `numbered-part-overlay` MUST render above all finish layers.

#### Scenario: Markers render above recolored or retextured parts
- **WHEN** a part has an active finish selection (color or texture mode) and a numbered marker overlaps that region
- **THEN** the marker is drawn fully above the finish layer

#### Scenario: Color-mode mask is applied last
- **WHEN** a color-mode finish is applied
- **THEN** the layer's children are ordered shading → color rect (multiply) → mask (destination-in) and no gray smears appear outside the mask

#### Scenario: Texture-mode mask is applied last
- **WHEN** a texture-mode finish is applied
- **THEN** the layer's children are ordered texture image → mask (destination-in) and no texture pixels appear outside the mask

### Requirement: Multiple simultaneous part finishes
The system MUST support independent finish selections on multiple parts at once. Selections on different parts MUST NOT interfere with one another, regardless of render mode. Selections on overlapping masks MUST composite in the parts manifest's declaration order (later-declared part wins in overlapping pixels).

#### Scenario: Two non-overlapping parts both have finishes
- **WHEN** the user selects a color-mode finish for part `07` and a texture-mode finish for part `10`
- **THEN** both regions render with their respective finishes and neither interferes with the other

#### Scenario: Overlapping masks composite in declaration order
- **WHEN** two part masks have overlapping alpha regions
- **THEN** the part declared later in `parts.json` wins in the overlap region
