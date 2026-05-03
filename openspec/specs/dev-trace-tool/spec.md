# dev-trace-tool Specification

## Purpose
TBD - created by archiving change enhance-dev-trace. Update Purpose after archive.
## Requirements
### Requirement: Tool scope and gating
The `/dev/trace` page MUST only be reachable in development. Its companion API route at `/api/dev/parts` MUST respond `404` when `process.env.NODE_ENV !== "development"`. The page itself SHALL still render in production (a static informational placeholder is acceptable), but no edit operations may succeed.

#### Scenario: Production gates disable the API
- **WHEN** the app is built with `NODE_ENV=production` and `/api/dev/parts` is requested via `GET` or `PUT`
- **THEN** the response status is `404` and no file-system access occurs

#### Scenario: Development unlocks the API
- **WHEN** `npm run dev` is running and `/api/dev/parts` is requested via `GET`
- **THEN** the response is `200` with the current `parts.json` body and an `mtime` field

### Requirement: Autosave to disk via dev API
The tool MUST debounce-autosave the in-memory manifest to `public/assets/base/main/parts.json` through the dev API on every editing mutation. The debounce window SHALL be 600 ms; consecutive mutations within the window collapse into a single PUT. The PUT body MUST be the full manifest (not a delta).

#### Scenario: Single edit triggers a single PUT after the debounce window
- **WHEN** the designer drags a vertex once and then leaves the canvas idle for 600 ms
- **THEN** exactly one PUT is sent and the response indicates success

#### Scenario: Rapid edits collapse into one PUT
- **WHEN** the designer makes 5 mutations within 600 ms
- **THEN** exactly one PUT is sent after the last mutation, carrying the final manifest state

#### Scenario: Successful save updates the on-screen "saved at" indicator
- **WHEN** a PUT succeeds
- **THEN** the side panel shows `保存済み HH:MM:SS` reflecting the server-reported timestamp

### Requirement: Atomic disk writes with one-deep backup
On a successful PUT, the server MUST write atomically by emitting `parts.json.tmp`, renaming the previous `parts.json` to `parts.json.bak` (overwriting any prior `.bak`), and then renaming `parts.json.tmp` to `parts.json`. The `.bak` file MUST be ignored by git via `.gitignore`.

#### Scenario: Rolling backup is kept, no accumulation
- **WHEN** three successful PUTs occur in sequence
- **THEN** at each step `parts.json.bak` contains the immediately-prior version of `parts.json` and no other `.bak.<n>` files exist

#### Scenario: Crash mid-write leaves a recoverable state
- **WHEN** the server process is killed during the rename sequence
- **THEN** `parts.json` either holds the previous version or the new version — never a partial / invalid file

### Requirement: Server-side schema validation on write
The PUT handler MUST validate the request body against the live `partsManifestSchema` (the same Zod schema used at runtime). On validation failure, the response MUST be `422` with a body containing `{ field, message }` from the first Zod issue, and the on-disk file MUST NOT be modified.

#### Scenario: Invalid manifest is rejected
- **WHEN** a PUT carries a manifest where one part's polygon has fewer than 3 vertices
- **THEN** the response is `422` with the failing field path and message
- **AND** `parts.json` on disk is unchanged

#### Scenario: Valid manifest passes
- **WHEN** a PUT carries a schema-valid manifest
- **THEN** the response is `200` with the new mtime and the disk file is updated

### Requirement: localStorage draft as failover
On every mutation, the tool MUST mirror the current manifest to a localStorage key `dev:trace:parts:<sceneId>` together with a `savedAt` timestamp, regardless of API state. This draft is the recovery surface when the API is unreachable.

#### Scenario: API failure preserves work in localStorage
- **WHEN** the dev server stops mid-session and the designer makes 2 more edits
- **THEN** localStorage holds the latest manifest and the toast informs the designer that local backup is in effect

#### Scenario: API recovery flushes the draft
- **WHEN** the dev server is restored and the next debounced PUT succeeds
- **THEN** the localStorage draft is cleared and the saved-at indicator reflects the server timestamp

### Requirement: Mount-time draft restoration
On mount, the tool MUST GET the current `parts.json` (with mtime) and read the localStorage draft. If the draft's `savedAt` is newer than `mtime + 2s`, the tool MUST display a non-blocking prompt naming both timestamps and offering "ドラフトを復元 / 破棄". Otherwise the tool loads the disk version and clears any draft silently.

#### Scenario: Newer draft offers restore
- **WHEN** the designer reloads the page after an unsaved edit on a stale disk file
- **THEN** the prompt names both the disk mtime and draft savedAt and offers restore vs. discard

#### Scenario: Disk is fresher (e.g., after `git pull`) — no prompt
- **WHEN** the disk mtime is newer than the localStorage draft's savedAt
- **THEN** no prompt is shown, the disk version loads, and the local draft is cleared

#### Scenario: No draft — no prompt
- **WHEN** localStorage has no draft for the active scene
- **THEN** no prompt is shown and the disk version loads

### Requirement: Edge-midpoint vertex insertion
Clicking on the canvas SHALL insert a new vertex at the perpendicular foot of the click point onto the nearest polygon edge **when** the click is within 12 px of an edge segment of the editing part's polygon. Clicks farther than 12 px from any edge MUST fall through to the existing append-to-end behavior so that empty or sparse polygons remain buildable.

#### Scenario: Click on edge inserts midpoint at correct position
- **WHEN** the designer clicks at a point within 12 px of the segment between vertices `[i]` and `[i+1]`
- **THEN** a new vertex is inserted between them at the perpendicular foot of the click on that segment
- **AND** all subsequent vertex indices shift by one

#### Scenario: Click far from any edge appends
- **WHEN** the designer clicks at a point >12 px from every edge of the editing polygon
- **THEN** a new vertex is appended at the end of the polygon

### Requirement: Undo / Redo
The tool SHALL maintain a per-tool history stack of depth ≥ 30. The following actions MUST push a new history entry: vertex add, vertex delete, vertex drag-end, marker drag-end, polygon clear, extractor import. Switching the editing part SHALL also push a checkpoint. `Cmd/Ctrl+Z` MUST undo and `Cmd/Ctrl+Shift+Z` MUST redo. The side panel MUST also expose Undo / Redo buttons that reflect the current stack state (disabled when no further entries exist).

#### Scenario: Drag end is one undo step
- **WHEN** the designer drags a vertex from `(x1,y1)` to `(x2,y2)` and releases
- **THEN** one undo entry is pushed
- **AND** Cmd+Z restores the vertex to `(x1,y1)`

#### Scenario: Switching part is a checkpoint
- **WHEN** the designer edits part 7, switches to part 8, edits part 8, then presses Cmd+Z three times
- **THEN** the first Cmd+Z undoes the last part-8 edit, the second undoes the part-switch (returning the editing focus to part 7), and the third undoes the last part-7 edit

#### Scenario: Drag-move does NOT spam history
- **WHEN** a drag emits 100 mousemove events between mousedown and mouseup
- **THEN** at most one undo entry is pushed for that drag

### Requirement: Extractor import (per-part, with confirm)
The tool MUST provide an "Import from extractor" action that GETs `/tmp/parts-extracted.json` via `/api/dev/parts?source=extracted`. On success, a per-part comparison panel SHALL list each part with current vs. extracted polygon vertex counts and bbox sizes, and per-part toggles for "import polygon" and "import marker". Applying the selected imports MUST mutate the in-memory manifest and push one undo entry per imported part. If `/tmp/parts-extracted.json` does not exist, the response is `404` and the tool surfaces a clear message ("先に `node scripts/extract-pdf-polygons.mjs` を実行してください").

#### Scenario: Per-part import overwrites only selected fields
- **WHEN** the designer imports the polygon for part 7 and the marker for part 10 from the extractor
- **THEN** part 7's polygon and part 10's marker are replaced from the extractor
- **AND** all other parts and other fields remain untouched
- **AND** two undo entries are pushed (one per affected part)

#### Scenario: Missing extractor output surfaces a friendly error
- **WHEN** the designer clicks "Import from extractor" but `/tmp/parts-extracted.json` does not exist
- **THEN** the tool shows a message naming the missing file and the script that produces it

### Requirement: Other-part visibility toggle
A 3-state toggle in the side panel SHALL control how non-editing parts render on the canvas: `all` (faint dashed outlines, current behavior, default), `current` (only the editing part is rendered with its outline + handles + marker), `hidden` (only the editing part's polygon outline; no markers, no other parts). The selection MUST persist across sessions in localStorage.

#### Scenario: "current" hides other-part outlines
- **WHEN** the toggle is set to `current`
- **THEN** no faint dashed outlines are rendered for parts other than the editing one
- **AND** the editing part's marker remains visible

#### Scenario: Preference persists across reloads
- **WHEN** the toggle is set to `hidden` and the page is reloaded
- **THEN** the toggle is `hidden` on next mount

### Requirement: Auto-regenerate mask + shading after save
After every successful autosave PUT, the tool MUST schedule a debounced (~1.5 s) regeneration of mask and shading PNGs by POSTing to `/api/dev/parts/regen`. The regen endpoint MUST select which parts to regenerate by comparing each part's current polygon-and-asset-filename hash to a per-part hash recorded in a sidecar file `public/assets/base/main/parts.json.regen.json` (see "Per-part regeneration hash sidecar" below) — regenerating any part whose recorded hash is missing or out of date. The regen status MUST surface in the header (`マスク再生成 待機中…` → `マスク再生成 中…` → `マスク更新 <N>件 HH:MM:SS`, with the longer reload hint moved to a tooltip). On regen failure, the side panel SHALL surface a non-blocking error.

This requirement closes the gap that triggered the bug "ポリゴンを更新したのに、メインアプリで部材を選ぶと旧ポリゴンの形で塗られる" — `parts.json` was being persisted by autosave but the mask PNGs that the runtime composes against weren't being refreshed.

#### Scenario: Successful PUT triggers a regen for changed parts
- **WHEN** the designer makes one polygon edit on part 7 and the autosave PUT succeeds
- **THEN** within ~2 s a POST to `/api/dev/parts/regen` is issued
- **AND** the response indicates `regenerated: ["07"]`
- **AND** `mask_07.png` (and `shading_07.png` if part 7 is color-mode) on disk has a newer mtime than before the edit

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
The regen endpoint MUST persist a sidecar file `public/assets/base/main/parts.json.regen.json` with shape `{ version: 1, parts: { [partId]: hashString } }`. After every successful regen, the sidecar SHALL be updated to record, for each regenerated part, the FNV-1a 32-bit hash of `JSON.stringify(part.polygon) + "|" + part.mask + "|" + (part.shading ?? "")`. Hash entries for unchanged parts MUST be preserved across writes. The sidecar MUST be written atomically (via `.tmp` + `rename`). Both `parts.json.regen.json` and `parts.json.regen.json.tmp` MUST be gitignored.

The sidecar replaces the earlier `parts.json` vs `parts.json.bak` diff, which only kept one step of history and silently dropped earlier edits when a regen request was missed for any reason (network blip, dev-server restart mid-edit, manual `parts.json` edit outside the tool, etc.). With the sidecar, drift is bounded to "until the next regen call" rather than "permanent".

#### Scenario: Sidecar grows on first regen
- **WHEN** the regen endpoint runs against a clean checkout where `parts.json.regen.json` does not exist
- **THEN** every part is regenerated and the sidecar is written with one hash entry per part

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

### Requirement: Force-regen all parts (safety valve)
The regen endpoint MUST accept a `?force=true` query parameter that bypasses the sidecar diff and regenerates every part declared by `parts.json`. The header MUST expose a "全マスク再生成" button that POSTs with `force=true`. After the call, the sidecar MUST be updated so subsequent diff regens correctly return `regenerated: []`.

This is the recovery surface when the sidecar itself drifts (e.g., the designer hand-edited `parts.json` outside the dev API, or restored the file from `git`).

#### Scenario: Force regen rebuilds every mask
- **WHEN** the designer clicks "全マスク再生成" in the header
- **THEN** the regen endpoint is POSTed with `?force=true`
- **AND** the response is `{ regenerated: [<all 17 part ids>], mode: "force", durationMs: <N> }`
- **AND** every mask + shading PNG on disk has a newer mtime than before the click

#### Scenario: Force regen reconciles the sidecar
- **WHEN** the sidecar is missing or out of date and the designer triggers a force regen
- **THEN** after completion, a subsequent non-force regen call returns `{ regenerated: [], mode: "diff" }` (the sidecar now reflects every part)

### Requirement: Mask / shading URL cache-bust on the runtime
The runtime app at `/` MUST attach a per-part `?v=<rev>` query string to every `mask_<id>.png` and `shading_<id>.png` URL it loads via `useImage`, where `<rev>` is the same FNV-1a hash used by the regen sidecar (computed from the part's polygon and asset filenames at parts.json load time and attached to each part as `_rev`). The hash MUST change whenever the polygon or filenames change, so that after a /dev/trace edit + regen, the next render of `/` requests a brand-new URL and the browser's image cache (and the in-process `useImageCache` Map) cannot serve the previously-loaded mask.

Without the cache-bust, even after the mask file on disk is rewritten, the browser may continue to serve the cached PNG (the URL is unchanged), and the React-side `useImageCache` Map keys by URL too — so the runtime keeps compositing on the old shape. This requirement closes that loop.

#### Scenario: First load attaches cache-bust query string
- **WHEN** the runtime loads `/` and selects a finish for part 7
- **THEN** the network request is to `mask_07.png?v=<rev>` (and `shading_07.png?v=<rev>` for color-mode parts), not the bare URL

#### Scenario: Polygon edit changes the rev string
- **WHEN** part 7's polygon is edited via /dev/trace and the regen completes
- **THEN** on the next reload of `/`, the mask request URL has a different `?v=` query than before

#### Scenario: Unchanged parts keep their rev across reloads
- **WHEN** part 7 was edited but parts 1 – 6 and 8 – 17 were not
- **THEN** on the next reload of `/`, only part 7's mask URL `?v=` differs; the other parts' URLs are byte-identical to the previous load

### Requirement: Click-to-add-vertex passes through the polygon fill
The editing-part polygon `<Line>` SHALL render with `listening={false}` so that clicks landing inside its semi-transparent fill region are NOT captured by the Line shape. Clicks MUST always reach the Stage's `onClick` handler, which then routes the event through `nearestEdge` (insert a vertex at the perpendicular foot if within tolerance of an existing edge) or falls through to "append a new vertex at the end of the polygon."

The editing-part polygon's vertex `<Circle>` handles MUST remain interactive (default `listening={true}`) so they continue to receive `onContextMenu` for right-click delete and `onDragStart` / `onDragMove` / `onDragEnd` for vertex drag.

This requirement closes the bug "クリック頂点追加・右クリック頂点削除が動かない" — without `listening={false}` on the Line, the polygon's blue 10%-opacity fill swallowed all clicks inside the polygon, and on small parts the right-click that should have hit a vertex Circle instead landed on the Line below it.

#### Scenario: Click empty area inside the polygon appends a vertex
- **WHEN** the designer clicks at a point inside the editing polygon, far from any existing edge
- **THEN** a new vertex is appended at the end of the polygon at the click coordinates

#### Scenario: Click on the polygon stroke inserts a midpoint
- **WHEN** the designer clicks within ~12 px of an existing polygon edge
- **THEN** a new vertex is inserted between that edge's two endpoints at the perpendicular foot of the click

#### Scenario: Right-click a vertex circle deletes it
- **WHEN** the designer right-clicks a vertex `<Circle>`
- **THEN** the vertex is deleted and the polygon closes around the surrounding vertices

### Requirement: Header layout is stable through autosave + regen state changes
The save badge ("保存済み HH:MM:SS" etc.) and the regen badge ("マスク更新 <N>件 HH:MM:SS" etc.) SHALL be rendered in a fixed-width column with `whitespace-nowrap`, so the header height never grows or shrinks as save / regen status transitions through `idle → saving → saved → scheduled → running → done`. Long status text (e.g., the "メイン画面はリロードで反映" reminder) MUST NOT be inlined — it belongs in the badge's `title` attribute (tooltip).

This requirement closes the bug "メッセージが表示されるたびに改行で縦方向の配置が変わり、画像の操作性を損なう".

#### Scenario: Header height does not shift during a save + regen cycle
- **WHEN** the designer triggers an edit that runs through `saving → saved → scheduled → running → done`
- **THEN** the `<header>` element's bounding-rect height remains constant
- **AND** the canvas's top Y position remains constant

### Requirement: Manual download remains available
The existing "parts.json をダウンロード" action MUST remain functional as an emergency fallback if the dev API is unreachable for any reason. It downloads the current in-memory manifest as a file named `parts.json`.

#### Scenario: Download still works alongside autosave
- **WHEN** the designer clicks the download button after several autosaved edits
- **THEN** the downloaded file matches the current in-memory manifest exactly

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

