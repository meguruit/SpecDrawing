## ADDED Requirements

### Requirement: Catalog data source
The system SHALL load the material catalog from a single JSON file at `public/catalog/materials.json` and validate it against a Zod schema at load time. If validation fails, the system MUST throw a visible error that names the failing entry and field, and MUST NOT render a partially-populated catalog UI.

#### Scenario: Valid catalog loads successfully
- **WHEN** the app starts and `materials.json` passes Zod validation
- **THEN** every catalog entry is available to the filtering UI

#### Scenario: Invalid catalog blocks startup with a clear error
- **WHEN** the app starts and `materials.json` fails Zod validation (e.g. an entry is missing `id`)
- **THEN** the app surfaces an error message naming the failing entry index and the violating field, and does not render the catalog panel

### Requirement: Catalog entry shape
Each catalog entry MUST have a globally unique `id`, a human-readable `name`, a `thumbnailUrl`, a `placementImageUrl` (the image drawn on the canvas when placed), and an `axes` object mapping axis keys to string values. Known axis keys SHALL include `series`, `design`, `color`, `width`, `height`, `openingType`, `mirror`, and `type`. Unknown axis keys MUST be permitted and treated as generic filters.

#### Scenario: Entry with all known axes
- **WHEN** an entry declares every known axis
- **THEN** it appears under each of those axes' filter groups

#### Scenario: Entry with an unknown axis
- **WHEN** an entry declares an axis key not in the known list (e.g. `finish`)
- **THEN** the UI creates a generic filter group for that key and lists the entry under it

#### Scenario: Duplicate id rejected
- **WHEN** two entries share the same `id`
- **THEN** catalog validation fails at load time with an error naming the duplicated id

### Requirement: Multi-axis filtering
The catalog UI MUST let the user filter entries by any combination of axes. Selecting a value within an axis filters to entries whose axis value matches; selecting across axes composes with logical AND. Selecting no values in an axis MUST NOT filter on that axis.

#### Scenario: Single-axis filter
- **WHEN** the user selects `color = "mBN"` and makes no other selection
- **THEN** only entries whose `axes.color === "mBN"` are shown

#### Scenario: Cross-axis filter composes with AND
- **WHEN** the user selects `color = "mBN"` and `series = "N"`
- **THEN** only entries matching both axis values are shown

#### Scenario: Clearing an axis reverts its contribution
- **WHEN** the user deselects all values in the `color` axis while a `series` filter is still active
- **THEN** entries are filtered by `series` only

### Requirement: Filtered result rendering
The catalog panel SHALL render filtered entries as a grid of thumbnails with the entry `name` visible on hover or beneath the thumbnail. Clicking a thumbnail MUST add that material to the canvas via the `presentation-canvas` capability.

#### Scenario: Thumbnail click places material
- **WHEN** the user clicks a thumbnail in the filtered grid
- **THEN** a new material instance is added to the canvas at a default position

#### Scenario: Empty filter result
- **WHEN** the active filter combination yields zero entries
- **THEN** the panel shows an empty-state message indicating no matches
