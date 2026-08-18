## ADDED Requirements

### Requirement: Zone polygon authoring works in production

The exterior workspace's polygon editor SHALL be available in the production deployment. It MUST NOT be gated behind the development/preview gate that protects `/dev/trace`, and it MUST NOT depend on any development-only API route, on writes to the server filesystem, or on the parts-manifest regeneration pipeline.

#### Scenario: Editor works on the production deployment

- **WHEN** a user opens the exterior workspace on the production deployment and clicks on the canvas
- **THEN** a zone vertex is added, with no request issued to any development-only endpoint

#### Scenario: Editor has no server dependency

- **WHEN** the user authors zones with the network offline after the page has loaded
- **THEN** vertex add, delete, drag, undo, and redo all continue to work

### Requirement: Click-to-add vertex with edge-midpoint insertion

Clicking on the canvas SHALL insert a new vertex at the perpendicular foot of the click point onto the nearest ring edge **when** the click is within 12 px of an edge segment of the active zone. Clicks farther than 12 px from any edge MUST append a new vertex at the end of the active ring, so that empty or sparse zones remain buildable.

#### Scenario: Click on an edge inserts a midpoint

- **WHEN** the user clicks within 12 px of the segment between vertices `[i]` and `[i+1]` of the active zone
- **THEN** a new vertex is inserted between them at the perpendicular foot of the click on that segment
- **AND** all subsequent vertex indices shift by one

#### Scenario: Click far from any edge appends

- **WHEN** the user clicks more than 12 px from every edge of the active zone
- **THEN** a new vertex is appended at the end of the active ring

#### Scenario: Clicks pass through the zone fill

- **WHEN** the user clicks inside the active zone's semi-transparent editing fill, far from any edge
- **THEN** the click reaches the stage handler and appends a vertex — the fill does not swallow the click

### Requirement: Vertex manipulation

Vertex handles of the active zone MUST remain interactive. Right-clicking a vertex handle MUST delete that vertex, and dragging a vertex handle MUST move it, with the zone's rendered fill following the new geometry on release. A ring MUST NOT be reducible below 3 vertices by deletion; an attempt to delete the third-to-last vertex of a ring MUST be refused with an explanatory message.

#### Scenario: Right-click deletes a vertex

- **WHEN** the user right-clicks a vertex handle of the active zone
- **THEN** that vertex is removed and the ring closes around the surrounding vertices

#### Scenario: Drag moves a vertex

- **WHEN** the user drags a vertex handle from one point to another and releases
- **THEN** the vertex is at the new position and the zone's fill re-renders to the new geometry

#### Scenario: A ring cannot drop below three vertices

- **WHEN** the user right-clicks a vertex of a ring that has exactly 3 vertices
- **THEN** the deletion is refused with a message and the ring keeps its 3 vertices

### Requirement: Undo and redo for zone authoring

The editor SHALL maintain a history stack of depth ≥ 30. Vertex add, vertex delete, vertex drag-end, ring clear, zone add, zone delete, and zone-selection change MUST each push exactly one history entry. `Cmd/Ctrl+Z` MUST undo and `Cmd/Ctrl+Shift+Z` MUST redo, and the UI MUST expose Undo and Redo controls that are disabled when no further entries exist in that direction.

#### Scenario: A drag is a single undo step

- **WHEN** a vertex drag emits 100 pointer-move events between press and release
- **THEN** at most one history entry is pushed for that drag, and one undo restores the vertex's original position

#### Scenario: Zone deletion is undoable

- **WHEN** the user deletes a zone that has 12 vertices and an assigned colour, then presses `Cmd/Ctrl+Z`
- **THEN** the zone is restored with its 12 vertices and its assigned colour

#### Scenario: Redo controls reflect stack state

- **WHEN** the user has performed no undo
- **THEN** the Redo control is disabled

### Requirement: Zone lifecycle and identity

Zones SHALL be created, renamed, and deleted by the user. A newly created zone MUST receive a unique identifier and a default sequential label that the user can rename to free text. Deleting a zone MUST require confirmation when that zone has 3 or more vertices. Zone geometry MUST use the multi-ring polygon shape (an outer ring plus optional hole rings) already used by the parts manifest, with at least 3 vertices per ring.

#### Scenario: New zone gets a unique id and default label

- **WHEN** the user creates a third zone in an angle
- **THEN** the zone has an identifier distinct from the other two and a default sequential label the user can edit

#### Scenario: Renaming a zone

- **WHEN** the user renames a zone to `外壁-南面`
- **THEN** that label appears in the zone list and in the exported spec sheet

#### Scenario: Deleting a drawn zone asks first

- **WHEN** the user deletes a zone that has 12 vertices
- **THEN** a confirmation is required before the zone is removed

### Requirement: Holes within a zone

A zone SHALL support hole rings that are excluded from its fill, so that openings such as windows and doors inside a wall zone are not painted. Adding a hole MUST attach it to the zone's outer ring, and hole vertices MUST be editable with the same interactions as outer-ring vertices.

#### Scenario: A hole is not painted

- **WHEN** the user adds a hole ring around a window opening inside a wall zone that has an assigned colour
- **THEN** the window area shows the original base image and the surrounding wall shows the assigned colour

#### Scenario: Hole vertices are editable

- **WHEN** the user drags a vertex of a hole ring
- **THEN** the hole's shape updates and the unpainted region follows it

### Requirement: Zone list and selection

The workspace SHALL render a list of the active angle's zones showing, per row, the zone label, its assigned colour number (or an unassigned indicator), and its opacity. Clicking a row MUST select that zone identically to clicking the zone on the canvas. Exactly one zone at most is selected at a time, and the selected zone MUST be visually distinguished both in the list and on the canvas.

#### Scenario: List row selects the zone

- **WHEN** the user clicks a zone's row in the list
- **THEN** that zone becomes the active zone, its vertex handles appear on the canvas, and its row is highlighted

#### Scenario: Unassigned zones are marked

- **WHEN** a zone has no colour assigned
- **THEN** its list row shows an unassigned indicator rather than a colour number

#### Scenario: Clearing selection hides handles

- **WHEN** the user clears the zone selection
- **THEN** no vertex handles are drawn and the zone fills remain rendered

### Requirement: Zone stacking order

Zones SHALL be composited in an explicit order that the user can change by reordering the zone list. When two zones overlap, the one later in the order MUST be drawn over the earlier one.

#### Scenario: Reordering changes what shows on top

- **WHEN** two zones overlap and the user moves the lower zone to the end of the order
- **THEN** the overlapping region renders that zone's colour on top

### Requirement: Shared polygon-editing implementation

The interaction rules above — the 12 px edge-midpoint insertion, the vertex hit and delete behaviour, the non-listening fill, and the history semantics — MUST be implemented once and shared between `/dev/trace` and the exterior zone editor rather than duplicated. The shared implementation MUST NOT depend on development-only APIs, on the parts manifest, or on either mode's persistence layer.

#### Scenario: Both editors share one implementation

- **WHEN** the 12 px edge tolerance is changed in the shared implementation
- **THEN** both `/dev/trace` and the exterior zone editor observe the new tolerance with no further change

#### Scenario: Shared implementation carries no persistence

- **WHEN** the shared polygon-editing module is inspected
- **THEN** it references neither the development parts API, nor `localStorage` drafts, nor IndexedDB
