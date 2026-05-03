## Why

Today a part is a **single closed polygon**. Real customer scenes routinely break that:

- ⑬ パネル ドレタスB-XF (closet doors) — two physically-separate door slabs that the workbook treats as one part.
- ⑨ スポットライト — currently traced as one big bbox; each spotlight cluster is its own region.
- ⑥ 吊り棚金具 — left + right hanging shelf hardware are two separate pieces.
- ⑰ サッシ枠 — the actual frame is a thin ring around glass; today's filled rectangle tints the glass too.

Both shape constraints (multi-region + holes) require the same pieces: a multi-ring polygon schema, a rasterizer that accepts multiple rings with even-odd fill semantics, hit-testing that respects holes, and `/dev/trace` UI for adding sub-polygons and holes. Per the `improve-finish-fidelity` design D1, bundling the two saves ~7 h vs shipping them separately.

## What Changes

- **BREAKING (schema)**: `parts.json` part record's `polygon: Vertex[]` field becomes `polygons: Array<{ outer: Vertex[]; holes?: Vertex[][] }>`. Existing single-polygon parts migrate to a 1-element array `[{ outer: <existing vertices> }]` with no holes.
- **Loader compatibility window**: for one release, the parts loader accepts BOTH the old `polygon` field and the new `polygons` field, normalizing the old shape on load. The next change after this one removes the legacy code path.
- **Mask rasterizer rewrite** (`lib/dev/regenAssets.ts`): scan every ring; outer rings contribute alpha 1, hole rings subtract alpha to 0 (even-odd fill). The union of all polygons in a part becomes the alpha-true region, minus all hole rings.
- **Hit-test rewrite** (`PartMarkerLayer` / `lib/parts/hitTest.ts`): a click hits a part if any of its `polygons[i].outer` contains the point AND none of that polygon's `holes[*]` contains the point.
- **`/dev/trace` UI extensions**:
  - "ポリゴンを追加" button under the editing part — appends a new `{ outer: [], holes: [] }` entry; subsequent vertex clicks build it.
  - "穴を追加" toggle — when active, the next click sequence builds a hole ring under the active outer.
  - Side panel groups vertices by `polygons[i].outer` / `polygons[i].holes[j]` with sub-section headings.
  - Active sub-polygon / hole indicator (which ring is being edited).
  - Undo entries cover ring add / hole add / ring delete just like vertex operations.
- **`parts.json` migration script** (`scripts/migrate-parts-multiring.mjs`): one-pass rewrite of the existing manifest from `polygon` → `polygons: [{ outer }]`. Idempotent (re-running produces no diff).
- **Schema-level guards**: an outer ring MUST have ≥ 3 vertices; a hole MUST have ≥ 3 vertices; holes MUST be declared inside a parent polygon entry, not at the top level. Validation surfaces named errors at load time.
- **Per-part regen hash sidecar** stays compatible — the FNV-1a hash now derives from `JSON.stringify(part.polygons)` instead of `part.polygon`, so any topology change invalidates the cached mask.

## Capabilities

### New Capabilities
<!-- None — this change extends two existing capabilities. -->

### Modified Capabilities
- `numbered-part-overlay`: per-part polygon model gains multi-region + holes. Schema changes from `polygon: Vertex[]` to `polygons: Array<{ outer; holes? }>`; mask rasterizer adopts even-odd fill across rings; hit-test respects holes; loader accepts legacy shape for one release; `/dev/trace` exposes sub-polygon and hole authoring.
- `dev-trace-tool`: editing UI gains "ポリゴンを追加" / "穴を追加" affordances and groups the side panel by ring. Undo/redo extends to ring-level operations.

## Impact

- **New code**:
  - `scripts/migrate-parts-multiring.mjs` — one-shot migration.
  - Rewritten `lib/dev/regenAssets.ts` rasterizer (per-ring scanning + even-odd fill).
  - Rewritten `components/parts/PartMarkerLayer.tsx` hit-test path (point-in-polygon-with-holes).
  - New `lib/parts/hitTest.ts` helper used by both runtime and `/dev/trace`.
  - `app/dev/trace/TraceTool.client.tsx` UI changes: ring picker, "ポリゴンを追加", "穴を追加".
- **Modified code**:
  - `lib/parts/types.ts` Zod schema — `polygons` array, ring shape, ≥ 3 vertices guard.
  - `lib/parts/load.ts` — accept old + new shape, normalize on load.
  - `app/api/dev/parts/route.ts` PUT validator — same Zod schema reuse.
- **Migrated data**: `public/assets/base/main/parts.json` rewritten to multi-ring shape (every existing part wraps in `[{ outer: <existing> }]` with no holes).
- **No new dependencies**.
- **Asset re-generation**: every part gets `mask_<NN>.png` + `shading_<NN>.png` re-emitted because the per-part regen hash changes. One-time `npm run seed:masks` after migration.
- **Backward compat**: old `parts.json` (with `polygon`) still loads for one release, producing a deprecation warning in dev. The compatibility shim is removed in the change AFTER this one.
- **Estimated effort**: ~30 h (per `improve-finish-fidelity` proposal sizing).
- **Spec relationship**: closes `improve-finish-fidelity` Items 1 + 2 in a single bundle. `improve-finish-fidelity` task 2.1 should be marked done when this change is archived.
