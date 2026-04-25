## ADDED Requirements

### Requirement: Per-part color override
The system SHALL allow the user to assign an arbitrary HEX color to any part declared by the active scene. Assigning a color to a part MUST composite that color onto the base image, masked by the part's `mask_<part>.png` alpha and modulated by the part's `shading_<part>.png` luminance, so the chosen color visibly lands only on the intended region while preserving the base image's lighting and shading.

#### Scenario: Assigning a color recolors only the masked region
- **WHEN** a scene declares a `wall` part and the user picks `#3B82F6` for it
- **THEN** pixels within the `mask_wall.png` alpha region appear tinted toward the chosen color and pixels outside it are unchanged from `base.jpg`

#### Scenario: Shading is preserved under the chosen color
- **WHEN** a part's `shading_<part>.png` has darker regions representing shadow
- **THEN** the recolored output shows those regions darker than the base recolor, preserving the original lighting cues

#### Scenario: Clearing a part's color restores the base
- **WHEN** the user clears the color override for a part
- **THEN** the canvas reverts that region to the unmodified `base.jpg` pixels

### Requirement: No hue-rotate fallback
The color composition pipeline MUST NOT use CSS `filter: hue-rotate` or any filter that changes hue without preserving luminance and saturation fidelity. Color application MUST go through the mask + shading compositing path.

#### Scenario: Implementation uses composite operations, not hue-rotate
- **WHEN** a part color is applied
- **THEN** the rendered output is produced by Konva composite operations on mask and shading layers, and not by a CSS hue-rotate filter

### Requirement: Scene-declared parts
The set of color-mutable parts is defined by each scene's `scene.json`. The color picker UI MUST only offer parts declared by the currently active scene. Attempting to set a color on a part not declared by the active scene MUST be rejected.

#### Scenario: UI lists only declared parts
- **WHEN** the active scene's `scene.json` declares parts `["wall", "floor"]`
- **THEN** the color picker lists `wall` and `floor` as the only targetable parts

#### Scenario: Part-not-declared rejection
- **WHEN** a caller attempts to set a color for a part id not present in the active scene's declaration
- **THEN** the store rejects the update and the canvas is unchanged

### Requirement: Composite layer ordering
The bottom of the canvas MUST be the base scene image. Above it, each color-overridden part MUST render onto its **own dedicated canvas layer**, isolated from other parts. Within a single part's layer the children draw in this order:

1. **Shading image** at full scene size (no compositing operator — it becomes the destination).
2. **Color fill rect** at full scene size with `globalCompositeOperation="multiply"`. After this step the layer holds (shading × color) RGB everywhere on the scene, including outside the target part.
3. **Mask image** at full scene size with `globalCompositeOperation="destination-in"`. This clips the (shading × color) result to the mask's alpha and clears everything else to transparent.

The per-part layer is then composited onto the stage with normal `source-over` blending; this is what guarantees one part's intermediate composite operations cannot leak into another part's region. Placed material instances from the `presentation-canvas` capability MUST render above all color-composition layers.

The mask MUST be applied **last** within a part's layer. Performing the multiply after the mask leaks the shading image's RGB onto the alpha-0 regions outside the mask (Canvas2D `multiply` against a transparent destination yields opaque source pixels), producing gray smears. Conversely, putting multiple parts onto a single shared layer also breaks isolation, because each part's first draw step (full-scene shading) overwrites the previous part's already-masked content. Earlier drafts of this spec described "groups on a single layer" and the operator `source-in`; both were incorrect and are superseded by this requirement.

#### Scenario: Materials render above recolored parts
- **WHEN** a part has an active color override and a material instance overlaps that region
- **THEN** the material instance is drawn fully above the recolored region

### Requirement: Multiple simultaneous part overrides
The system MUST support independent color overrides on multiple parts at once. Overrides on different parts MUST NOT interfere with one another; overrides on overlapping masks MUST composite in scene-declaration order.

#### Scenario: Two non-overlapping parts both recolored
- **WHEN** the user sets colors for `wall` and `floor` simultaneously
- **THEN** both regions render with their respective color overrides and both preserve their own shading

#### Scenario: Overlapping masks composite in declaration order
- **WHEN** two part masks have overlapping alpha regions
- **THEN** the part declared later in `scene.json` wins in the overlap region
