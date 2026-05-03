## 1. Schema + loader compatibility

- [x] 1.1 Update `lib/parts/types.ts` Zod schema: add `RingSchema` (`z.array(VertexSchema).min(3)`), `PolygonSchema` (`{ outer, holes? }`), and the `polygon | polygons` discriminated refinement on `PartSchema`
- [x] 1.2 Export a `Polygon` / `Ring` TypeScript type from `lib/parts/types.ts` for use in rasterizer + hit-test
- [x] 1.3 Update `lib/parts/load.ts` to normalize legacy `polygon` to `polygons: [{ outer: <existing> }]` post-validation, and emit a dev-only `console.warn` directing the contributor to the migration script

## 2. Migration script

- [x] 2.1 Create `scripts/migrate-parts-multiring.mjs` that rewrites `polygon` → `polygons: [{ outer }]` on every part, idempotently, preserving trailing newline
- [x] 2.2 Add an `npm run migrate:multiring` script entry to `package.json`
- [x] 2.3 Document the migration step in `resources/reference/AUTHORING.md` (one-shot run, then `npm run seed:masks`, then verify smoke)

## 3. Rasterizer

- [x] 3.1 Rewrite `lib/dev/regenAssets.ts` mask rasterizer to scan every ring of every `polygons` entry with even-odd fill (single pass, scanline-based)
- [x] 3.2 Preserve the existing 1-pixel half-coverage AA on edge crossings
- [x] 3.3 Add a golden-pixel test (or a one-shot script under `scripts/verify-mask-parity.mjs`) that compares pre-migration mask SHA-256 vs post-migration mask SHA-256 for every existing 17-part record after migration; expect byte-identical
- [x] 3.4 Update the per-part regen sidecar hash input from `JSON.stringify(part.polygon)` to `JSON.stringify(part.polygons)` in the regen endpoint (`app/api/dev/parts/regen/route.ts`)

## 4. Hit-test

- [x] 4.1 Create `lib/parts/hitTest.ts` exporting `pointInPart(part, [x, y]): boolean` using ray-casting `pointInPolygon` per ring (any outer hits AND no parent hole hits)
- [x] 4.2 Update `components/parts/PartMarkerLayer.tsx` to use `pointInPart` instead of the inlined single-polygon check
- [x] 4.3 Update `app/dev/trace/TraceTool.client.tsx` (or its `PartHitLayer` equivalent) to use `pointInPart` so editing-mode hit-test matches runtime semantics

## 5. /dev/trace UI — sub-polygons + holes

- [x] 5.1 Add "ポリゴンを追加" button to the editing-part side panel; clicking it appends `{ outer: [], holes: [] }`, sets active sub-polygon, pushes one undo entry
- [x] 5.2 Add "穴を追加" toggle; while active, canvas clicks build a new ring under `polygons[active].holes`; toggle off via Esc, click "穴を完了", or right-click context-end
- [x] 5.3 Side panel: render foldable groups per `polygons[i]` and per ring (outer + each hole); show vertex count, active highlight, and (poly, ring kind, vertex index) per row
- [x] 5.4 Extend edge-midpoint insertion (`nearestEdge`) to scan every ring of every polygon entry of the active part; insert into the closest ring
- [x] 5.5 Render every ring of the editing part as its own `<Line>` in `TraceTool.client.tsx` (each with `listening={false}` per existing invariant); hole rings get a distinguishable dash pattern from outer rings
- [x] 5.6 Update hover affordance in `PartMarkerLayer.tsx` — when hovering any outer ring, render every outer + every hole of that part with the category color; holes use a shorter dash to distinguish from outers
- [x] 5.7 Push undo entries for: addPolygon, removePolygon, addHole, removeHole (1 entry each); existing vertex add/drag-end/delete continue to push 1 each

## 6. Server-side validation

- [x] 6.1 `app/api/dev/parts/route.ts` PUT handler reuses the updated Zod schema (no code change beyond import); verify 422 surfaces ring-level errors (e.g., `polygons[0].holes[0]: Array must contain at least 3 element(s)`)
- [x] 6.2 Add a soft warning at PUT time when a hole has no vertex contained by its parent's outer (geometric-validity check via `pointInPolygon` on the hole's first vertex against its parent outer)

## 7. Apply migration to the repo

- [x] 7.1 Run `node scripts/migrate-parts-multiring.mjs` against `public/assets/base/main/parts.json` and commit the result
- [x] 7.2 Run `npm run seed:masks` to regenerate every `mask_<NN>.png` and `shading_<NN>.png` under the new sidecar hash; commit the regenerated PNGs and the updated `parts.json.regen.json`
- [x] 7.3 Verify mask parity test (3.3) passes — every existing part's mask is byte-identical to pre-migration

## 8. Smoke + docs

- [ ] 8.1 Smoke `/`: load with all 17 parts, no visual diff vs pre-migration; click each part's marker — selection works *(needs interactive `npm run dev`; parity script confirms masks are byte-identical)*
- [ ] 8.2 Smoke `/dev/trace`: every part shows a single outer ring; "ポリゴンを追加" appends a new outer and canvas drawing builds it; "穴を追加" inside an existing outer cuts a transparent hole that appears in the runtime composite after `seed:masks` *(needs interactive `npm run dev`)*
- [ ] 8.3 Smoke hit-test: a hole inside ⑰ (sash frame) — clicking inside the hole does NOT select ⑰; clicking the surrounding ring does *(needs interactive `npm run dev`)*
- [x] 8.4 Update `README.md` "Asset conventions" section to describe the `polygons` shape (replace single-polygon description); add a note that legacy `polygon` is accepted for one release with deprecation warning
- [x] 8.5 Update `resources/reference/AUTHORING.md` with the "ポリゴンを追加" / "穴を追加" workflow and a worked example (e.g., authoring ⑬ as 2 outer rings, ⑰ as 1 outer + 1 hole)

## 9. Closure

- [x] 9.1 Mark `improve-finish-fidelity` task 2.1 as done in its `tasks.md` once this change is archived
- [ ] 9.2 Open a follow-up issue / change to remove the legacy `polygon` loader path one release after this ships *(deferred — open after this ships)*
