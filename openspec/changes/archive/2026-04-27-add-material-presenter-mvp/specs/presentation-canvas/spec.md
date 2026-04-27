## ADDED Requirements

### Requirement: Base scene selection and loading
The system SHALL offer a scene picker that lists all scenes declared under `public/assets/base/`. Selecting a scene MUST load its `base.jpg` as the bottom layer of the canvas. A scene descriptor (`scene.json`) MUST accompany each scene and enumerate the color-mutable `parts` it declares.

#### Scenario: Scene loads on selection
- **WHEN** the user picks a scene from the scene picker
- **THEN** the canvas renders that scene's `base.jpg` as its bottom layer and exposes the scene's declared parts to the `color-composition` capability

#### Scenario: Scene missing required asset fails visibly
- **WHEN** a selected scene's `scene.json` declares a part but the corresponding `mask_<part>.png` or `shading_<part>.png` file is missing
- **THEN** the loader surfaces an error naming the scene and missing file, and does not leave the canvas in a half-loaded state

### Requirement: Placing materials from the catalog
The canvas MUST accept material additions triggered by the `material-catalog` capability. Each addition creates a new placed-material instance with a unique instance id, positioned at a default location (visible within the viewport) using the catalog entry's `placementImageUrl`. Multiple instances of the same catalog entry MUST be allowed.

#### Scenario: First placement lands at default position
- **WHEN** the user clicks a catalog thumbnail with an empty canvas
- **THEN** a material instance appears at a deterministic default position inside the canvas viewport

#### Scenario: Subsequent placements offset to avoid full overlap
- **WHEN** the user places the same catalog entry twice in succession
- **THEN** the two instances are positioned with a small offset so both are visible

### Requirement: Material instance manipulation
Placed material instances MUST be selectable, draggable, and deletable. Selection MUST be single-instance at a time in the MVP. A selected instance SHALL display a visible selection affordance (border or handles). Pressing the Delete or Backspace key with an instance selected MUST remove it. Clicking an empty area of the canvas MUST deselect.

#### Scenario: Click to select
- **WHEN** the user clicks a placed material instance
- **THEN** that instance becomes the single selected instance and a selection affordance is shown

#### Scenario: Drag to move
- **WHEN** the user drags a selected instance
- **THEN** the instance follows the cursor and its new position is persisted in the canvas state

#### Scenario: Delete key removes selected instance
- **WHEN** the user presses Delete or Backspace while an instance is selected
- **THEN** that instance is removed from the canvas and nothing is selected

#### Scenario: Click background deselects
- **WHEN** the user clicks the canvas background while an instance is selected
- **THEN** the selection clears and the selection affordance is removed

### Requirement: Canvas state model
The canvas state MUST be held in a Zustand store and MUST include: the active scene id, an ordered list of placed material instances (each with instance id, catalog entry id, position, and creation order for z-order), a per-part color overrides map (keyed by scene part id), and the current selection (instance id or null).

#### Scenario: State-driven rendering
- **WHEN** the store's placed-material list changes
- **THEN** the canvas re-renders to reflect the new list without losing selection on unrelated instances

#### Scenario: Scene switch resets instances but preserves catalog
- **WHEN** the user switches the active scene
- **THEN** placed material instances and per-part color overrides are cleared, and the catalog panel remains populated

### Requirement: Client-only rendering boundary
All Konva rendering MUST live inside a single client component loaded via `next/dynamic` with `ssr: false`. Server-rendered pages MUST NOT reference Konva symbols.

#### Scenario: No SSR crash on initial load
- **WHEN** the `/` page is requested and rendered by the Next.js server
- **THEN** the response succeeds with no Konva-related import errors
