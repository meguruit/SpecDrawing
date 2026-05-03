## ADDED Requirements

### Requirement: Add a sub-polygon to the editing part
The tool MUST expose a "ポリゴンを追加" affordance on the editing part's side panel. Activating it appends a new entry `{ outer: [], holes: [] }` to the active part's `polygons` array and sets that entry as the active sub-polygon. Subsequent canvas clicks build the new entry's `outer` ring (using the existing append + edge-midpoint-insert logic). The side panel MUST indicate which sub-polygon is currently being edited (e.g., "編集中: ②/③").

Adding a sub-polygon MUST push exactly one entry onto the undo stack. Undoing it MUST remove the appended entry (and any vertices added to it before the undo).

#### Scenario: Adding a sub-polygon makes it active
- **WHEN** the designer activates "ポリゴンを追加" on a part that currently has 1 polygon entry
- **THEN** `part.polygons.length` becomes 2
- **AND** the active sub-polygon index becomes 1
- **AND** the side panel shows "編集中: ②/②"

#### Scenario: Clicking on canvas after add appends to the new outer
- **WHEN** the designer clicks an empty canvas point shortly after activating "ポリゴンを追加"
- **THEN** the click adds a vertex to `polygons[active].outer`, not to the previous sub-polygon's outer

#### Scenario: Undo removes the added sub-polygon
- **WHEN** the designer activates "ポリゴンを追加" and then immediately presses Cmd+Z
- **THEN** `part.polygons.length` reverts to its pre-add value
- **AND** the active sub-polygon index reverts to the previously active one

### Requirement: Add a hole to the active sub-polygon
The tool MUST expose a "穴を追加" toggle on the editing part's side panel. When activated, the next sequence of canvas clicks builds a new ring under `polygons[active].holes`. The toggle MUST remain active until the designer explicitly deactivates it (via toggling off, pressing Esc, or right-clicking "穴を完了"). While the toggle is active, edge-midpoint insertion targets only the in-progress hole ring; vertex drag and right-click delete continue to operate on whichever vertex circle the designer interacts with.

Adding a hole MUST push exactly one entry onto the undo stack. The undo MUST remove the entire hole ring (including all vertices added before the undo).

#### Scenario: Hole ring is built under the active sub-polygon
- **WHEN** the designer activates "穴を追加" on `polygons[0]` and clicks 4 canvas points
- **THEN** `polygons[0].holes[0]` contains 4 vertices in click order
- **AND** `polygons[0].outer` is unchanged

#### Scenario: Toggle off ends hole-build mode
- **WHEN** the designer toggles "穴を追加" off after building a hole
- **THEN** the next canvas click appends to `polygons[active].outer`, not to a hole

#### Scenario: Hole counts toward Zod min-3-vertex guard at save
- **WHEN** the designer activates "穴を追加" and clicks only 2 canvas points before triggering autosave
- **THEN** the autosave PUT is rejected with a 422 naming the offending hole ring
- **AND** the on-disk `parts.json` is unchanged
- **AND** the side panel surfaces a non-blocking error directing the designer to add a third vertex or delete the hole

### Requirement: Side panel groups vertices by ring
The editing-part side panel MUST group vertices by `polygons[i]` and within each entry by ring kind (outer, then each hole). Each group MUST be foldable, MUST display its ring's vertex count, and MUST highlight the active sub-polygon and the active hole (when "穴を追加" is on or a hole has focus). Each vertex row MUST show its (poly index, ring kind, vertex index) and the vertex coordinates, so the designer can locate any specific point.

#### Scenario: Each polygon entry renders as its own foldable group
- **WHEN** a part has 2 `polygons` entries (each with 1 outer ring and 0 holes)
- **THEN** the side panel shows 2 foldable groups labeled "① / outer" and "② / outer"
- **AND** each group lists its vertices

#### Scenario: Hole rings nest under their parent outer
- **WHEN** a part has 1 `polygons` entry with 1 outer ring and 2 holes
- **THEN** the side panel shows 1 foldable group for "① / outer" and 2 sub-groups for "① / hole 1" and "① / hole 2"

### Requirement: Edge-midpoint insertion targets all rings of the active part
The existing edge-midpoint vertex insertion logic (insert at the perpendicular foot when the click is within 12 px of an edge segment) SHALL extend to every ring of every `polygons` entry of the editing part. The closest edge across all rings wins; vertices are inserted into that ring at the corresponding index. Clicks farther than 12 px from any ring's edge MUST fall through to "append to the active outer (or active hole if hole-build mode is on)."

#### Scenario: Click near a hole's edge inserts a midpoint into that hole
- **WHEN** the designer clicks within 12 px of a segment of `polygons[0].holes[0]`
- **THEN** a new vertex is inserted into `polygons[0].holes[0]` between that segment's endpoints

#### Scenario: Click near an outer's edge inserts into that outer
- **WHEN** the designer clicks within 12 px of `polygons[1].outer` and the active sub-polygon is 0
- **THEN** a new vertex is inserted into `polygons[1].outer` (the click hits the closest edge regardless of active sub-polygon)
