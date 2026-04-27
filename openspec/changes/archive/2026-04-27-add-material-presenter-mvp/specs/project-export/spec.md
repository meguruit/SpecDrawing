## ADDED Requirements

### Requirement: Export to PNG
The system SHALL provide an "Export PNG" action that produces a downloadable PNG of the current canvas, including the base scene image, all active color overrides, and all placed material instances in their current positions. The export MUST reflect exactly what the user sees on screen at the moment of export.

#### Scenario: Export matches on-screen state
- **WHEN** the user has placed two material instances and applied one color override, then clicks "Export PNG"
- **THEN** the downloaded PNG contains the base image, the color override applied to the correct masked region, and both material instances at their on-screen positions

#### Scenario: Export on empty canvas
- **WHEN** the user clicks "Export PNG" on a canvas with only a base scene and no materials or overrides
- **THEN** the downloaded PNG is the base scene image at the export resolution

### Requirement: Export resolution
PNG export MUST use `pixelRatio: 2` against the Konva stage so that exported pixels are twice the stage's logical pixel dimensions. The exported image MUST NOT include any editor chrome (selection handles, grid, scrollbars).

#### Scenario: Retina-quality export
- **WHEN** the Konva stage's logical size is 1024×768 and the user clicks "Export PNG"
- **THEN** the downloaded PNG is 2048×1536 pixels

#### Scenario: Selection affordance excluded from export
- **WHEN** a material instance is selected (with visible handles) at the moment of export
- **THEN** the downloaded PNG does not contain the selection handles or border

### Requirement: Download filename
The downloaded file's name MUST follow the pattern `specdrawing-<sceneId>-<YYYYMMDDHHmmss>.png`, using the active scene id and the local-time export timestamp.

#### Scenario: Filename includes scene and timestamp
- **WHEN** the user exports while the `living-room-01` scene is active on 2026-05-01 at 14:30:22 local time
- **THEN** the downloaded file is named `specdrawing-living-room-01-20260501143022.png`

### Requirement: Export action availability
The "Export PNG" action MUST be disabled when no scene is loaded and enabled otherwise. Clicking it with an unloaded scene MUST NOT produce a download.

#### Scenario: Disabled before scene load
- **WHEN** the user has not yet selected a scene
- **THEN** the "Export PNG" button is visibly disabled and triggers no download when clicked
