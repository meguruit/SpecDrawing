## ADDED Requirements

### Requirement: Per-variant mask polygon authoring
On a scene whose `scene.json` declares variants, the `/dev/trace` editor MUST let the designer choose an active variant and trace a distinct mask polygon set for the editing part under that variant, persisted to the part's `maskPolygonsByVariant[variantKey]` and rasterized to `maskByVariant[variantKey]`. The editor MUST surface a variant selector that also swaps the displayed base image to that variant's `baseImageUrl`, so the designer traces against the perspective the mask will be used on.

Selecting a variant for which the part has no `maskPolygonsByVariant` entry yet MUST seed the editing rings from the part's base `polygons` (a starting point the designer then adjusts), and persist them under that variant's key on first edit. Editing under the scene's default/"base" selection MUST continue to edit the shared `polygons` (which drives hit-testing and is the fallback for variants without their own entry). Switching the active variant MUST NOT alter the part's `marker` or the shared `polygons` used for hit-testing.

When the part has at least one `maskPolygonsByVariant` entry, the editor MUST make clear (in the side panel) which variant's rings are currently being edited, and MUST allow removing a variant's override (reverting that variant to the base mask).

#### Scenario: Selecting a variant swaps base image and seeds rings
- **WHEN** the designer selects variant `flat` for a part that has no `maskPolygonsByVariant["flat"]`
- **THEN** the canvas base image switches to `flat`'s `baseImageUrl`
- **AND** the editing rings are seeded from the part's shared `polygons`

#### Scenario: Editing under a variant persists to maskPolygonsByVariant
- **WHEN** the designer edits a vertex while variant `flat` is active and the autosave PUT succeeds
- **THEN** `parts.json` records the edited rings under the part's `maskPolygonsByVariant["flat"]`
- **AND** the part's shared `polygons` and `marker` are unchanged

#### Scenario: Editing under the base selection edits shared polygons
- **WHEN** the designer edits a vertex with the base/default selection active (no variant)
- **THEN** the edit is persisted to the part's shared `polygons`

#### Scenario: Removing a variant override reverts to base mask
- **WHEN** the designer removes the `flat` override for a part
- **THEN** `maskPolygonsByVariant["flat"]` and `maskByVariant["flat"]` are dropped from that part
- **AND** after regen the runtime composites the `flat` variant against the part's base `mask`

## MODIFIED Requirements

### Requirement: Auto-regenerate mask + shading after save
After every successful autosave PUT, the tool MUST schedule a debounced (~1.5 s) regeneration of mask and shading PNGs by POSTing to `/api/dev/parts/regen`. The regen endpoint MUST select which parts to regenerate by comparing each part's current polygon-and-asset-filename hash to a per-part hash recorded in a sidecar file `public/assets/base/main/parts.json.regen.json` (see "Per-part regeneration hash sidecar" below) — regenerating any part whose recorded hash is missing or out of date. For each part selected for regen, the endpoint MUST rewrite the base `mask` (from `polygons`), the `shading` PNG if the part is color-mode, AND one mask PNG per `maskPolygonsByVariant` entry (written to the corresponding `maskByVariant` filename). The regen status MUST surface in the header (`マスク再生成 待機中…` → `マスク再生成 中…` → `マスク更新 <N>件 HH:MM:SS`, with the longer reload hint moved to a tooltip). On regen failure, the side panel SHALL surface a non-blocking error.

This requirement closes the gap that triggered the bug "ポリゴンを更新したのに、メインアプリで部材を選ぶと旧ポリゴンの形で塗られる" — `parts.json` was being persisted by autosave but the mask PNGs that the runtime composes against weren't being refreshed.

#### Scenario: Successful PUT triggers a regen for changed parts
- **WHEN** the designer makes one polygon edit on part 7 and the autosave PUT succeeds
- **THEN** within ~2 s a POST to `/api/dev/parts/regen` is issued
- **AND** the response indicates `regenerated: ["07"]`
- **AND** `mask_07.png` (and `shading_07.png` if part 7 is color-mode) on disk has a newer mtime than before the edit

#### Scenario: Per-variant edit regenerates the variant mask
- **WHEN** the designer edits part 7's `flat` mask polygons and the autosave PUT succeeds
- **THEN** the regen response includes `"07"` and the file named by part 7's `maskByVariant["flat"]` has a newer mtime than before the edit
- **AND** part 7's base `mask` is also rewritten

#### Scenario: Burst of edits collapses into a single regen
- **WHEN** the designer makes 5 edits across 3 parts within 1.5 s of each other
- **THEN** at most one POST to `/api/dev/parts/regen` is issued after the burst settles
- **AND** the response lists every changed part exactly once

#### Scenario: No-op when nothing actually changed
- **WHEN** the regen endpoint runs and every part's current hash matches the sidecar
- **THEN** the regen endpoint returns `{ regenerated: [], mode: "diff", durationMs: 0 }` and writes no PNGs

#### Scenario: Production gates disable the regen endpoint
- **WHEN** `NODE_ENV !== "development"` and `/api/dev/parts/regen` is POSTed
- **THEN** the response is `404` and no file-system access occurs

### Requirement: Per-part regeneration hash sidecar
The regen endpoint MUST persist a sidecar file `public/assets/base/main/parts.json.regen.json` with shape `{ version: 1, parts: { [partId]: hashString } }`. After every successful regen, the sidecar SHALL be updated to record, for each regenerated part, the FNV-1a 32-bit hash of `JSON.stringify(part.polygons) + "|" + part.mask + "|" + (part.shading ?? "") + "|" + JSON.stringify(part.maskByVariant ?? null) + "|" + JSON.stringify(part.maskPolygonsByVariant ?? null)`. Hash entries for unchanged parts MUST be preserved across writes. The sidecar MUST be written atomically (via `.tmp` + `rename`). Both `parts.json.regen.json` and `parts.json.regen.json.tmp` MUST be gitignored.

The sidecar replaces the earlier `parts.json` vs `parts.json.bak` diff, which only kept one step of history and silently dropped earlier edits when a regen request was missed for any reason (network blip, dev-server restart mid-edit, manual `parts.json` edit outside the tool, etc.). With the sidecar, drift is bounded to "until the next regen call" rather than "permanent".

#### Scenario: Sidecar grows on first regen
- **WHEN** the regen endpoint runs against a clean checkout where `parts.json.regen.json` does not exist
- **THEN** every part is regenerated and the sidecar is written with one hash entry per part

#### Scenario: Per-variant change is reflected in the hash
- **WHEN** a part's `maskPolygonsByVariant` is edited but its base `polygons` is unchanged
- **THEN** the part's recorded sidecar hash differs from the previous hash and the part is selected for regen

#### Scenario: Sidecar self-heals dropped earlier edits
- **WHEN** part A's polygon was edited but a previous regen call failed to run, and later part B's polygon is edited
- **THEN** the next regen call regenerates both A and B (because both A's and B's recorded hashes are stale or missing)
- **AND** the sidecar records the new hashes for both

#### Scenario: Sidecar is preserved on partial regen
- **WHEN** only parts A and B are regenerated in one call
- **THEN** the sidecar still contains the hashes for parts C, D, … (unchanged) plus the new hashes for A and B

#### Scenario: Atomic sidecar write — no partial state on crash
- **WHEN** the server process is killed during the sidecar rename sequence
- **THEN** `parts.json.regen.json` either holds the previous version or the new version — never a partial / invalid file

### Requirement: Mask / shading URL cache-bust on the runtime
The runtime app at `/` MUST attach a per-part `?v=<rev>` query string to every `mask_<id>.png`, per-variant mask, and `shading_<id>.png` URL it loads via `useImage`, where `<rev>` is the same FNV-1a hash used by the regen sidecar (computed from the part's polygons, asset filenames, and per-variant mask data at parts.json load time and attached to each part as `_rev`). The hash MUST change whenever the polygons, filenames, `maskByVariant`, or `maskPolygonsByVariant` change, so that after a /dev/trace edit + regen, the next render of `/` requests a brand-new URL and the browser's image cache (and the in-process `useImageCache` Map) cannot serve the previously-loaded mask.

Without the cache-bust, even after the mask file on disk is rewritten, the browser may continue to serve the cached PNG (the URL is unchanged), and the React-side `useImageCache` Map keys by URL too — so the runtime keeps compositing on the old shape. This requirement closes that loop.

#### Scenario: First load attaches cache-bust query string
- **WHEN** the runtime loads `/` and selects a finish for part 7
- **THEN** the network request is to `mask_07.png?v=<rev>` (and `shading_07.png?v=<rev>` for color-mode parts), not the bare URL

#### Scenario: Polygon edit changes the rev string
- **WHEN** part 7's polygon is edited via /dev/trace and the regen completes
- **THEN** on the next reload of `/`, the mask request URL has a different `?v=` query than before

#### Scenario: Per-variant mask edit changes the rev string
- **WHEN** part 7's `maskPolygonsByVariant["flat"]` is edited via /dev/trace and the regen completes
- **THEN** on the next reload of `/`, part 7's mask URLs carry a different `?v=` query than before

#### Scenario: Unchanged parts keep their rev across reloads
- **WHEN** part 7 was edited but parts 1 – 6 and 8 – 17 were not
- **THEN** on the next reload of `/`, only part 7's mask URL `?v=` differs; the other parts' URLs are byte-identical to the previous load
