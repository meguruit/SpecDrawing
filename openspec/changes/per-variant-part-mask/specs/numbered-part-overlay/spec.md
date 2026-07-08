## MODIFIED Requirements

### Requirement: Numbered-part manifest per scene
Each registered base perspective MUST be accompanied by a numbered-part manifest at `public/assets/base/<scene-id>/parts.json`, validated against a Zod schema at load time. The manifest SHALL enumerate every changeable region of the perspective as a part record containing: a stable string id (zero-padded, e.g. `"01"` … `"17"`), a Japanese label, a category, the source-PDF reference (1, 2, or 3, matching `部材対応番号-<n>.pdf`), the marker centroid in scene-pixel coordinates, **a `polygons` array (one or more entries, each `{ outer: Vertex[], holes?: Vertex[][] }`) describing the part's region(s)**, the declared render mode (`"color"` or `"texture"`), and the mask filename relative to the scene directory. Color-mode parts MUST additionally declare a shading filename. Texture-mode parts MUST NOT declare a shading filename (the field is rejected by the schema).

A part record MAY additionally declare per-variant mask data so a single part can present a different masked region on each switchable base image (`scene.json` `variants`):

- `maskByVariant?: Record<variantKey, filename>` — the mask filename (relative to the scene directory) used when that variant is active. Keys MUST be variant keys declared by the scene's `scene.json`; unknown keys are rejected at load time.
- `maskPolygonsByVariant?: Record<variantKey, Polygon[]>` — the polygon set (same `{ outer, holes? }` shape and per-ring ≥3-vertex rule as `polygons`) from which that variant's mask PNG is rasterized.

Both fields are optional and independent of one another only insofar as a `maskByVariant[key]` SHOULD have a corresponding `maskPolygonsByVariant[key]` so regen can produce it. When the active variant has no `maskByVariant` entry, the runtime MUST fall back to the part's base `mask`; when a variant has no `maskPolygonsByVariant` entry, regen MUST fall back to the part's base `polygons`. Hit-testing and marker placement (see "Marker rendering and hit-testing") are unaffected — they continue to use the single shared `polygons` and `marker` regardless of the active variant.

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

#### Scenario: Per-variant mask asset missing fails visibly
- **WHEN** a part declares `maskByVariant: { "natural": "mask_07__natural.png" }` but `mask_07__natural.png` is absent under the scene directory
- **THEN** the loader surfaces an error naming the scene, the part id, the variant key, and the missing file

#### Scenario: maskByVariant key not declared by the scene rejected
- **WHEN** a part declares a `maskByVariant` (or `maskPolygonsByVariant`) key that is not present in the scene's `scene.json` `variants`
- **THEN** validation fails at load time with an error naming the offending part id and the unknown variant key

#### Scenario: Part without per-variant mask falls back to the base mask
- **WHEN** a part declares no `maskByVariant` and any variant is active
- **THEN** the runtime resolves the part's mask to the base `mask` filename for every variant

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

### Requirement: Mask rasterization across multiple rings
The `seed:masks` rasterizer (and the dev-API regen endpoint) MUST produce `mask_<NN>.png` whose alpha channel is the union of all outer rings of `polygons` minus the union of all hole rings, computed via the **even-odd fill rule** scanline algorithm. The rasterizer MUST process every ring of every polygon entry in a single pass; outer and hole rings are NOT distinguished by the algorithm itself (they are distinguished only at authoring time and Zod validation).

When a part declares `maskPolygonsByVariant`, the rasterizer MUST additionally produce one mask PNG per declared variant, rasterizing `maskPolygonsByVariant[key]` with the same even-odd algorithm and writing it to the filename recorded in `maskByVariant[key]`. The base `mask` (from `polygons`) MUST continue to be produced regardless, serving as the fallback for any variant without a per-variant entry.

The output MUST be byte-identical to the legacy single-polygon rasterizer when the part has exactly one polygon entry with one outer ring and zero holes. This invariant lets us migrate existing parts without visual diff.

Anti-aliasing on edge crossings (1-pixel half-coverage at scanline boundaries) MUST continue to apply, unchanged from the prior single-polygon rasterizer.

For color-mode parts, `shading_<NN>.png` SHALL be derived from the bounding region of the union of all outer rings (no holes subtracted from the shading bounds — shading is a luminance source over the part's geometric envelope, sampled by the mask at runtime). Per-variant shading is OUT of scope: shading remains a single base asset and is not regenerated per variant.

#### Scenario: Single-polygon part rasterizes byte-identically post-migration
- **WHEN** an existing part is migrated from `polygon: <vertices>` to `polygons: [{ outer: <vertices> }]` and `seed:masks` runs
- **THEN** the resulting `mask_<NN>.png` has the same SHA-256 as the pre-migration mask

#### Scenario: Per-variant mask is rasterized from its own polygons
- **WHEN** a part declares `maskPolygonsByVariant: { "flat": <polygons-F>, "sharp": <polygons-S> }` and the rasterizer runs
- **THEN** the file named by `maskByVariant["flat"]` is rasterized from `<polygons-F>` and the file named by `maskByVariant["sharp"]` from `<polygons-S>`
- **AND** the base `mask` is still rasterized from the part's `polygons`

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

### Requirement: Per-part regen sidecar invalidates on topology change
The per-part hash sidecar at `public/assets/base/<scene-id>/parts.json.regen.json` (introduced by `dev-trace-tool`) MUST derive each part's hash from `JSON.stringify(part.polygons) + "|" + part.mask + "|" + (part.shading ?? "") + "|" + JSON.stringify(part.maskByVariant ?? null) + "|" + JSON.stringify(part.maskPolygonsByVariant ?? null)`. Any change to a part's `polygons`, `maskByVariant`, or `maskPolygonsByVariant` (vertex add/move/delete in any ring of any variant, ring add/remove, polygon entry add/remove, hole add/remove, variant add/remove) MUST produce a different hash so the regen endpoint detects the staleness and rewrites the affected masks.

#### Scenario: Adding a hole invalidates the cached hash
- **WHEN** a designer adds a hole ring to a part's `polygons[0]`
- **THEN** the part's recorded sidecar hash differs from the in-memory hash on the next regen call
- **AND** the regen endpoint regenerates that part's `mask_<NN>.png`

#### Scenario: Adding a second polygon entry invalidates the cached hash
- **WHEN** a designer adds a second `polygons` entry to a part
- **THEN** the part's recorded sidecar hash differs from the in-memory hash on the next regen call
- **AND** the regen endpoint regenerates that part's `mask_<NN>.png`

#### Scenario: Editing a per-variant polygon invalidates the cached hash
- **WHEN** a designer moves a vertex in `maskPolygonsByVariant["natural"]` of a part
- **THEN** the part's recorded sidecar hash differs from the in-memory hash on the next regen call
- **AND** the regen endpoint regenerates that part's per-variant mask for `natural`
