# numbered-part-overlay Specification

## Purpose
TBD - created by archiving change redesign-numbered-part-finish-picker. Update Purpose after archive.
## Requirements
### Requirement: Numbered-part manifest per scene
Each registered base perspective MUST be accompanied by a numbered-part manifest at `public/assets/base/<scene-id>/parts.json`, validated against a Zod schema at load time. The manifest SHALL enumerate every changeable region of the perspective as a part record containing: a stable string id (zero-padded, e.g. `"01"` … `"17"`), a Japanese label, a category, the source-PDF reference (1, 2, or 3, matching `部材対応番号-<n>.pdf`), the marker centroid in scene-pixel coordinates, **a `polygons` array (one or more entries, each `{ outer: Vertex[], holes?: Vertex[][] }`) describing the part's region(s)**, the declared render mode (`"color"` or `"texture"`), and the mask filename relative to the scene directory. Color-mode parts MUST additionally declare a shading filename. Texture-mode parts MUST NOT declare a shading filename (the field is rejected by the schema).

Each ring (outer or hole) MUST contain at least 3 vertices in scene-pixel coordinates as `[x, y]` pairs. The first vertex is NOT required to be repeated at the end. Outer rings define filled regions; hole rings declared on an outer subtract from that outer (even-odd fill rule). Multiple `polygons` entries describe disjoint regions (e.g., left + right closet door slabs); holes within one entry describe interior cuts (e.g., glass within a sash frame).

For one release after this change ships, the loader SHALL accept the legacy `polygon: Vertex[]` field as a synonym for `polygons: [{ outer: <existing> }]` and emit a development-only deprecation warning. A part record MUST set exactly one of `polygon` or `polygons` (not both, not neither) — validation rejects either error at load time.

⑫ 玄関床 SHALL remain `renderMode: "texture"` (per `finish-spec-catalog`'s per-option base-variant override). The migration step preserves its existing region as `polygons: [{ outer: <existing vertices> }]`.

#### Scenario: Parts manifest loads and validates
- **WHEN** a scene is loaded and its `parts.json` passes Zod validation
- **THEN** every part is available to the canvas overlay and to the `finish-spec-catalog` lookup
- **AND** every part exposes a normalized `polygons` array post-load (legacy `polygon` is wrapped on load)

#### Scenario: Color-mode part missing shading rejected
- **WHEN** a part declares `renderMode: "color"` but omits the `shading` field
- **THEN** validation fails at load time with an error naming the offending part id

#### Scenario: Texture-mode part with a shading field rejected
- **WHEN** a part declares `renderMode: "texture"` but also includes a `shading` field
- **THEN** validation fails at load time with an error naming the offending part id

#### Scenario: Mask asset missing fails visibly
- **WHEN** a part declares `mask: "mask_07.png"` but the file is absent under the scene directory
- **THEN** the loader surfaces an error naming the scene, the part id, and the missing file

#### Scenario: Outer ring with fewer than 3 vertices rejected
- **WHEN** any `polygons[i].outer` has fewer than 3 vertices
- **THEN** validation fails at load time with an error naming the part id and the ring index

#### Scenario: Hole ring with fewer than 3 vertices rejected
- **WHEN** any `polygons[i].holes[j]` has fewer than 3 vertices
- **THEN** validation fails at load time with an error naming the part id, the polygon index, and the hole index

#### Scenario: Both polygon and polygons set rejected
- **WHEN** a part record declares both the legacy `polygon` field and the new `polygons` field
- **THEN** validation fails at load time with an error naming the offending part id

#### Scenario: Neither polygon nor polygons set rejected
- **WHEN** a part record declares neither `polygon` nor `polygons`
- **THEN** validation fails at load time with an error naming the offending part id

#### Scenario: Legacy single-polygon shape loads with deprecation warning
- **WHEN** a part record uses the legacy `polygon: Vertex[]` field and `process.env.NODE_ENV === "development"`
- **THEN** the loader normalizes the part to `polygons: [{ outer: <legacy vertices> }]`
- **AND** a console warning names the part id and recommends running `scripts/migrate-parts-multiring.mjs`

### Requirement: Marker rendering and hit-testing
For each part in the active scene's manifest, the canvas MUST render a numbered marker (a circular badge containing the part number) anchored at the part's `marker` coordinates above the base image. Clicking inside any of the part's outer rings — and outside every hole declared on that outer — MUST select that part; clicking inside another part's region MUST switch the selection. Hit-testing MUST use point-in-polygon (ray-casting), not bounding-rect approximation, so non-rectangular regions (range hood, hanging shelves, accent cloth) are clickable accurately. A point inside a hole ring MUST NOT count as a hit on that part.

#### Scenario: Click inside an outer ring selects the part
- **WHEN** the user clicks inside the outer ring of any `polygons` entry of part `07`
- **THEN** `selectedPartId` becomes `"07"` and the finish-options panel for part `07` is shown

#### Scenario: Click inside a second outer ring of the same part also selects it
- **WHEN** part `13` has two `polygons` entries (left and right door slabs) and the user clicks inside the right slab's outer
- **THEN** `selectedPartId` becomes `"13"` (the same as clicking the left slab)

#### Scenario: Click inside a hole does not select the part
- **WHEN** part `17` (sash frame) has a polygon with one outer rectangle and one hole rectangle (the glass), and the user clicks inside the hole
- **THEN** `selectedPartId` does not become `"17"` — the click falls through to whatever part (or nothing) lies behind

#### Scenario: Click on marker selects the part
- **WHEN** the user clicks the numbered marker for part `07`
- **THEN** the same selection occurs as for an outer-ring click

#### Scenario: Click outside any outer ring clears selection
- **WHEN** the user clicks the canvas in an area not covered by any part's outer rings
- **THEN** `selectedPartId` becomes `null` and no finish-options panel is shown

### Requirement: Hover affordance
When the user hovers any of a part's outer rings (or its marker), the canvas MUST render every outer-and-hole ring of that part as a dashed overlay matching the color used for that part on the source `部材対応番号-*.pdf` (orange / blue / green / yellow per category). Outer rings MUST be drawn with the part's category color; hole rings MUST be drawn with the same color but a distinguishable stroke pattern (e.g., shorter dash) so the designer can tell them apart from outers. The outline MUST clear when the hover ends.

#### Scenario: Hover shows every ring of the hovered part
- **WHEN** the cursor enters any outer ring of part `13` (which has two outer rings, no holes)
- **THEN** both outer rings are rendered with dashed strokes above the base image
- **AND** when the cursor leaves all rings, every outline is removed

#### Scenario: Hover on a holed part shows outer + hole differently
- **WHEN** the cursor enters the outer ring of part `17` (one outer rectangle plus one hole rectangle)
- **THEN** the outer is rendered as a dashed stroke and the hole is rendered as a stroke with a distinguishable pattern

### Requirement: Number-overlay visibility toggle
The UI MUST expose a toggle that hides or shows all numbered markers and polygon outlines on the canvas. When markers are hidden, parts MUST still be selectable via the side list (provided by `presentation-canvas`). The toggle's default state MUST be "shown" on first app load.

#### Scenario: Toggle hides markers
- **WHEN** the user activates the "番号オーバーレイ" toggle to off
- **THEN** numbered markers and any active hover outlines are no longer rendered on the canvas
- **AND** the rendered finish layers continue to display

#### Scenario: Selection still works via side list when hidden
- **WHEN** markers are hidden and the user clicks part `15` in the side list
- **THEN** `selectedPartId` becomes `"15"` and the finish-options panel for part `15` is shown

### Requirement: Mask rasterization across multiple rings
The `seed:masks` rasterizer (and the dev-API regen endpoint) MUST produce `mask_<NN>.png` whose alpha channel is the union of all outer rings of `polygons` minus the union of all hole rings, computed via the **even-odd fill rule** scanline algorithm. The rasterizer MUST process every ring of every polygon entry in a single pass; outer and hole rings are NOT distinguished by the algorithm itself (they are distinguished only at authoring time and Zod validation).

The output MUST be byte-identical to the legacy single-polygon rasterizer when the part has exactly one polygon entry with one outer ring and zero holes. This invariant lets us migrate existing parts without visual diff.

Anti-aliasing on edge crossings (1-pixel half-coverage at scanline boundaries) MUST continue to apply, unchanged from the prior single-polygon rasterizer.

For color-mode parts, `shading_<NN>.png` SHALL be derived from the bounding region of the union of all outer rings (no holes subtracted from the shading bounds — shading is a luminance source over the part's geometric envelope, sampled by the mask at runtime).

#### Scenario: Single-polygon part rasterizes byte-identically post-migration
- **WHEN** an existing part is migrated from `polygon: <vertices>` to `polygons: [{ outer: <vertices> }]` and `seed:masks` runs
- **THEN** the resulting `mask_<NN>.png` has the same SHA-256 as the pre-migration mask

#### Scenario: Multi-region part fills both regions
- **WHEN** a part declares two `polygons` entries with non-overlapping outer rings and no holes
- **THEN** the resulting mask has alpha 1 inside either outer and alpha 0 elsewhere

#### Scenario: Hole subtracts from its parent outer
- **WHEN** a part declares one polygon entry with one outer rectangle and one hole rectangle inside it
- **THEN** the resulting mask has alpha 1 inside the outer and outside the hole, alpha 0 inside the hole or outside the outer

#### Scenario: Self-intersecting outer fills via even-odd
- **WHEN** a part declares an outer ring that crosses itself (figure-8)
- **THEN** the mask alpha follows the even-odd fill rule: regions enclosed an odd number of times are alpha 1, others alpha 0
- **AND** no exception is raised at rasterization time

### Requirement: Migration script for legacy parts.json
The repository MUST provide `scripts/migrate-parts-multiring.mjs` that rewrites every part record in `public/assets/base/<scene-id>/parts.json` from the legacy `polygon` field to `polygons: [{ outer: <legacy vertices> }]`. The script MUST be idempotent (running on an already-migrated file produces no changes), MUST preserve all other fields verbatim, and MUST keep the file's trailing newline convention.

#### Scenario: Migration rewrites every legacy part once
- **WHEN** the migration script runs against a `parts.json` where every part still uses `polygon`
- **THEN** every part now has `polygons: [{ outer: <vertices> }]`
- **AND** the `polygon` field is removed from each part
- **AND** the script's stdout reports `Migrated <N> parts to multi-ring shape`

#### Scenario: Migration is idempotent
- **WHEN** the migration script runs against an already-migrated `parts.json`
- **THEN** the file is byte-identical before and after
- **AND** the script's stdout reports `Migrated 0 parts to multi-ring shape`

### Requirement: Per-part regen sidecar invalidates on topology change
The per-part hash sidecar at `public/assets/base/<scene-id>/parts.json.regen.json` (introduced by `dev-trace-tool`) MUST derive each part's hash from `JSON.stringify(part.polygons) + "|" + part.mask + "|" + (part.shading ?? "")`. Any change to a part's `polygons` (vertex add/move/delete in any ring, ring add/remove, polygon entry add/remove, hole add/remove) MUST produce a different hash so the regen endpoint detects the staleness and rewrites the mask.

#### Scenario: Adding a hole invalidates the cached hash
- **WHEN** a designer adds a hole ring to a part's `polygons[0]`
- **THEN** the part's recorded sidecar hash differs from the in-memory hash on the next regen call
- **AND** the regen endpoint regenerates that part's `mask_<NN>.png`

#### Scenario: Adding a second polygon entry invalidates the cached hash
- **WHEN** a designer adds a second `polygons` entry to a part
- **THEN** the part's recorded sidecar hash differs from the in-memory hash on the next regen call
- **AND** the regen endpoint regenerates that part's `mask_<NN>.png`

### Requirement: Texture-as-default on variant-enabled scenes
For any scene whose `scene.json` `variants` array is non-empty AND whose primary sheet has `variantsEnabled === true` (currently: scene `main` with sheet `アーバンシー`), every part in `parts.json` whose role is NOT "accent cloth" MUST declare `renderMode: "texture"`. Accent-cloth parts (kitchen accent cloth and storage accent cloth) MUST declare `renderMode: "color"` so the customer's chosen `colorHex` continues to drive their appearance.

The accent-cloth exemption SHALL be expressed as an explicit list of part ids enumerated in this scene's parts manifest; no new schema field is introduced. The accent-cloth parts on scene `main` SHALL be exactly:

- `"07"` — キッチンアクセントクロス (`category: "キッチン"`)
- `"16"` — 収納アクセントクロス (`category: "収納アクセント"`)

These two parts MUST remain `renderMode: "color"` with a declared `shading` filename. Every other part in scene `main`'s `parts.json` MUST be `renderMode: "texture"`.

#### Scenario: Non-accent part on variant-enabled scene declares texture mode
- **WHEN** scene `main` is loaded and `parts.json` is validated
- **THEN** every part not in the accent-cloth list has `renderMode: "texture"`

#### Scenario: Accent-cloth part remains color mode
- **WHEN** scene `main` is loaded and `parts.json` is validated
- **THEN** parts `"07"` (キッチンアクセントクロス) and `"16"` (収納アクセントクロス) have `renderMode: "color"` and a declared `shading` filename
- **AND** every other part has `renderMode: "texture"` and no `shading` field

#### Scenario: Mismatch between sheet variants flag and parts.json render modes
- **WHEN** scene `main`'s sheet has `variantsEnabled: true` AND a non-accent-cloth part declares `renderMode: "color"` in `parts.json`
- **THEN** the loader surfaces an error at load time naming the offending part id and the policy violation

