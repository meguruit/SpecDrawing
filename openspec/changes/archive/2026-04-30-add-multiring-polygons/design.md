## Context

Today's part record carries a single closed polygon (`polygon: Vertex[]`). It is rasterized by a flood-fill into `mask_<NN>.png` (alpha 1 inside the closed polygon, 0 outside) and used by both the runtime composite (`destination-in` against the part's layer) and `/dev/trace` editing.

Two real-scene gaps drive this change:

1. **Multi-region parts** — closet doors, spotlight clusters, hanging shelf hardware. The workbook treats each as one logical part with one finish option list, but the visible region is two or more disjoint polygons. Today we hack around this by tracing one giant bbox that swallows the negative space.
2. **Holed parts** — sash frames are rings around glass. A filled rectangle tints the glass; a true ring needs the inside removed.

Per `improve-finish-fidelity` D1, both share infrastructure (multi-ring schema + rasterizer rewrite + `/dev/trace` UI), so they ship together as one change.

The downstream consumers we must keep correct are: runtime composite (mask is the single source of truth for visible region), hit-testing (point-in-region must respect holes), `/dev/trace` autosave + auto-regen (sidecar hash must change on any topology edit), and `parts.json` migration (one-shot, idempotent, accept-both during the compatibility window).

## Goals / Non-Goals

**Goals:**
- A part can declare ≥ 1 outer ring (disjoint regions) and each outer ring can have ≥ 0 inner rings (holes).
- Mask rasterization is byte-identical to today for parts that migrate to a single-outer / no-hole layout.
- Hit-test is point-in-any-outer AND point-in-no-hole-of-that-outer.
- `/dev/trace` UI: add another outer ring or add a hole inside the active outer, with vertex grouping on the side panel.
- One-pass `parts.json` migration script. Loader accepts the legacy `polygon` field for one release.
- Schema-level guards: outer ≥ 3 vertices, hole ≥ 3 vertices, holes only inside an outer.
- `_rev` cache-bust on mask URLs continues to invalidate on any topology change.

**Non-Goals:**
- No SVG path / Bézier support — straight-edge polygons only (matches current model).
- No automatic hole detection — the designer marks "this ring is a hole" via the UI mode toggle.
- No per-ring finish — one part = one finish; rings within a part are visual decomposition only, not separately finishable.
- No dynamic insertion of a ring around an existing region (i.e., no Boolean operations between parts). Out of scope.
- No removal of the legacy `polygon` field's loader path **in this change** — kept for one release. The next change deletes it.
- No re-tracing of existing parts. Existing 17 parts migrate as 1-outer / 0-hole and stay visually identical until a designer chooses to add rings.

## Decisions

### D1. Schema shape — GeoJSON-style `{ outer, holes? }[]`

Two reasonable shapes were considered (per `improve-finish-fidelity` D2):

A) **GeoJSON-like multi-polygon with explicit holes**:
```ts
polygons: Array<{ outer: Vertex[]; holes?: Vertex[][] }>
```

B) **Flat ring array with even-odd fill semantics**:
```ts
rings: Vertex[][]  // first outer; alternating in/out via even-odd
```

**Decision**: A. Implementation cost is the same (rasterizer scans rings in either case). Designer cognitive load is meaningfully lower in A — "this part has two regions, one has a window cut out" maps directly onto `polygons[1].holes[0]`. B requires the designer to remember ring ordering rules.

`Vertex` stays `[number, number]` (no change).

### D2. Rasterization — even-odd fill, scanline-based

The current rasterizer fills one closed polygon. The new one iterates every ring of every `polygons[i]`, accumulating into a single per-part alpha buffer using the **even-odd fill rule**:

- For each scanline y, find every edge crossing in every ring (outer or hole).
- Sort crossings left-to-right.
- Toggle "inside" at each crossing; emit alpha 1 where inside, 0 where outside.

Outer rings and hole rings are treated identically by the algorithm — a hole is just an additional ring that an even-odd walk subtracts from. (This is also how SVG `fill-rule: evenodd` works.) The outer/hole split in the schema is for **authoring clarity and validation**, not for the rasterizer.

**Why not "subtract holes after filling outers"**: the even-odd approach is simpler (one pass), handles overlap edge cases correctly, and is what every off-the-shelf 2D rasterizer (cairo, canvas2d `fill('evenodd')`, sharp + custom) uses. Subtracting requires deciding what "inside" means for nested or self-intersecting rings, and we'd reinvent even-odd anyway.

**Anti-aliasing**: same as today (currently a 1-pixel half-coverage estimate at edge crossings). No change to the AA pass; just runs after the multi-ring fill.

**Output**: one `mask_<NN>.png` per part, alpha-only PNG. `shading_<NN>.png` for color-mode parts is unchanged (the shading map still derives from the part's bounding region, now expanded to the union of all `polygons`).

### D3. Hit-test — point-in-any-outer AND point-in-no-hole

```ts
function hits(part, [px, py]): boolean {
  for (const poly of part.polygons) {
    if (!pointInPolygon(poly.outer, [px, py])) continue;
    if (poly.holes?.some(h => pointInPolygon(h, [px, py]))) continue;
    return true; // inside an outer, not inside any of that outer's holes
  }
  return false;
}
```

`pointInPolygon` is the standard ray-casting algorithm. We extract this into `lib/parts/hitTest.ts` so both `PartMarkerLayer` and `/dev/trace` use the same code. Today's hit-test logic is inlined in `PartMarkerLayer`; we move it out and rewrite to handle the multi-ring case.

### D4. Loader compatibility window

The Zod schema accepts a discriminated union:

```ts
const RingSchema = z.array(VertexSchema).min(3);
const PolygonSchema = z.object({
  outer: RingSchema,
  holes: z.array(RingSchema).optional(),
});
const PartSchema = z.object({
  // ...other fields...
  // Either legacy single polygon or new multi-ring:
  polygon: RingSchema.optional(),
  polygons: z.array(PolygonSchema).min(1).optional(),
}).refine(
  p => Boolean(p.polygon) !== Boolean(p.polygons),
  "exactly one of `polygon` or `polygons` must be set"
);
```

After validation, `lib/parts/load.ts` normalizes:
```ts
if (part.polygon) {
  part.polygons = [{ outer: part.polygon }];
  delete part.polygon;
  if (process.env.NODE_ENV === "development") console.warn(`[parts] part ${part.id} uses legacy single-polygon shape; migrate via scripts/migrate-parts-multiring.mjs`);
}
```

The runtime, the rasterizer, and `/dev/trace` only ever see `polygons` post-normalization. The dev-only deprecation warning steers contributors to run the migration. The next change after this one removes the `polygon` branch.

### D5. `/dev/trace` UI

Three new affordances on the editing-part side panel:

1. **"ポリゴンを追加" button** — appends `{ outer: [], holes: [] }` to the active part's `polygons`. Subsequent canvas clicks build the `outer` of the new entry. Active sub-polygon index is shown ("編集中: ②/③").
2. **"穴を追加" toggle** — when active, the next sequence of canvas clicks builds a new ring under `polygons[active].holes`. Reverts to outer-edit on toggle off or after right-click "穴を完了".
3. **Side panel grouping** — each `polygons[i]` rendered as a foldable section: outer first, then each hole sub-section. Vertices show their (poly index, ring kind, vertex index) so the designer can find a specific point.

Undo/redo stack entries:
- `addPolygon` / `removePolygon` — push 1 entry.
- `addHole` / `removeHole` — push 1 entry.
- Vertex add / drag-end / delete inside any ring — same as today, 1 entry per discrete user action.

The existing edge-midpoint insertion logic (`nearestEdge` within 12 px) extends to all rings of all polygons of the active part — the closest edge across every ring wins.

The polygon `<Line>` `listening={false}` invariant continues per ring (each ring drawn as its own `<Line>`).

### D6. Migration script

`scripts/migrate-parts-multiring.mjs`:

```js
import { readFile, writeFile } from "node:fs/promises";

const path = "public/assets/base/main/parts.json";
const json = JSON.parse(await readFile(path, "utf8"));
let mutated = 0;

for (const part of json.parts) {
  if (part.polygon && !part.polygons) {
    part.polygons = [{ outer: part.polygon }];
    delete part.polygon;
    mutated++;
  }
}

await writeFile(path, JSON.stringify(json, null, 2) + "\n");
console.log(`Migrated ${mutated} parts to multi-ring shape`);
```

**Idempotent**: running on an already-migrated file is a no-op (every part has `polygons`, `polygon` is absent → `mutated === 0`). The trailing newline matches the existing file's convention.

After running, `npm run seed:masks` regenerates every `mask_<NN>.png` (the per-part hash changes because `polygons` is a different JSON shape than `polygon`). `seed:masks` is already idempotent, so this is safe to run repeatedly.

### D7. Sidecar hash invariant

`parts.json.regen.json` records `FNV-1a(JSON.stringify(part.polygons) + "|" + part.mask + "|" + (part.shading ?? ""))` instead of the previous `polygon`-based hash. Every existing entry becomes stale on first regen after migration → every part regenerates exactly once → sidecar reconciles → subsequent runs are no-ops. This is acceptable: it's a one-time cost paid by `npm run seed:masks` after migration.

### D8. Schema-level guards (Zod)

- `RingSchema = z.array(VertexSchema).min(3)` — outer and holes both ≥ 3 vertices.
- `polygons` array `.min(1)` — at least one outer.
- `holes` is `optional()` (undefined or empty array both ok).
- `polygon` and `polygons` are mutually exclusive (refine).
- Old behavior — closed polygon is implicit (loader treats first vertex as also the last) — carries over: rings are NOT required to repeat the first vertex at the end.

## Risks / Trade-offs

- **[Risk] Migration runs against an in-flight `/dev/trace` edit, dev API has the old shape in memory**. → **Mitigation**: run migration when no dev server is running; the script touches only `parts.json` and not the regen sidecar. After migration, restart `npm run dev` and run `npm run seed:masks`. Document in `AUTHORING.md`.
- **[Risk] Designer accidentally creates a self-intersecting ring** (figure-8 outer or a hole that crosses itself). → **Mitigation**: even-odd fill produces a defined output for self-intersecting rings (the inside-toggle handles it), but the result may surprise the designer. `/dev/trace` already shows the ring as a `<Line>` in real time, so the designer sees the artifact. We add a soft warning if `lineSegmentsIntersect(...)` finds a self-crossing on save. No hard rejection — even-odd is well-defined.
- **[Risk] Hole declared outside any outer** (e.g., a stray hole entry wider than its parent outer). → **Mitigation**: the schema only allows holes nested in `polygons[i].holes`. The schema cannot prevent geometric invalidity (hole vertex outside outer), but `/dev/trace` shows the hole's render in real time, so visual feedback catches it. Add a warning at PUT time if no hole vertex is contained by its parent's outer ring.
- **[Risk] Rasterizer regression on edge cases** (zero-area triangles, degenerate vertices). → **Mitigation**: golden-pixel comparison test — check every existing part's mask is byte-identical before/after migration (with the hash sidecar updated). If divergence appears, gate on the test before landing.
- **[Trade-off] Compatibility window adds branches in the loader.** → Accepted because a hard cut-over forces every contributor to run the migration the same day. The deprecation warning + the next-change removal is cleaner.
- **[Trade-off] `polygons` semantics differs from many SVG / Konva libraries that take a flat ring array.** → Accepted because authoring clarity outweighs library-shape convenience. Internal helpers convert to flat-rings when calling Konva's `<Line>` per ring.

## Migration Plan

1. Land the schema + loader compat in one PR (this change). Existing `parts.json` keeps working.
2. Run `node scripts/migrate-parts-multiring.mjs` against the repo's `parts.json`. Commit the result.
3. Run `npm run seed:masks` to regenerate every mask under the new hash sidecar. Commit.
4. Verify smoke tests:
   - `/` loads with all 17 parts, no visual diff vs main.
   - `/dev/trace` opens, shows each part with a single outer (no holes) by default.
   - "ポリゴンを追加" appends a new outer; canvas drawing builds it.
   - "穴を追加" inside an existing outer; clicking inside builds a hole; mask updates and the runtime shows a transparent inside.
5. Open issue / next change to drop the legacy `polygon` field's loader path. Schedule for one release after this one ships.

**Rollback**: revert this change's PR. The pre-migration `parts.json` is preserved in git history; restoring it removes the multi-ring shape. `seed:masks` regenerates from the legacy shape.

## Open Questions

- **Q1**: Should `/dev/trace` enforce that every hole's vertices are inside its parent's outer at save time, or only warn? **A**: warn only — even-odd handles geometric edge cases predictably, and a hard reject would block the designer mid-edit. Reconsider if support burden grows.
- **Q2**: Should the migration script also rewrite `parts.json.bak` and the sidecar? **A**: no — the script touches only `parts.json`. The sidecar self-heals on next regen. `.bak` is gitignored and rolls naturally with the next autosave.
- **Q3**: Do we want a `polygons.length === 1` quick-path in the rasterizer (today's single-polygon code) for performance? **A**: no — the multi-ring rasterizer is O(rings × scanlines × edges-per-ring). For one outer with no holes the inner loop runs over one ring. The single-polygon fast-path duplicates code without measurable speedup at our scene size.
