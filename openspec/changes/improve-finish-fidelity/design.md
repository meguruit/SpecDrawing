## Context

This change is a **proposal-only scope memo**. The five items it captures (multi-region polygons, polygon holes, per-option texture fidelity, AI-assisted asset generation, background color correction) emerged from real-use feedback after `add-base-variant-finishes` shipped. Each item has a different implementation profile (schema migration vs. asset pipeline vs. research spike vs. asset replacement) and a different urgency, so the team needs to size and decide on them independently rather than implementing as one merged change.

This file records the design **considerations** for each item so the eventual per-item change starts from a shared understanding.

## Goals / Non-Goals

**Goals:**
- One central record of the open scope items so they aren't lost in chat.
- Per-item implementation profile (schema impact, pipeline impact, UI impact).
- Per-item sizing for the project-wide hour estimate.

**Non-Goals:**
- No code changes from this change directly.
- No final decision on Item 4 (AI exploration) — that's a separate go/no-go after the spike.
- No commitment to ship every item — sizing is so the team can pick a subset.

## Decisions

### D1. Item 1 + Item 2 should likely be one change

Multi-region polygons (Item 1) and polygon holes (Item 2) both require:

- A schema rewrite (single polygon → array of rings or a multi-polygon with holes).
- A mask rasterizer rewrite (per-ring scanning with even-odd or non-zero fill rule).
- `/dev/trace` UI work for adding/managing rings.

Doing them in one change saves ~7 h of overhead (one schema migration, one rasterizer rewrite). Recommendation: bundle. Working name `add-multiring-polygons` (vs. `add-multipolygon-parts` + `add-polygon-holes` separately).

### D2. The schema for multi-ring polygons

Two reasonable shapes:

A) **GeoJSON-style multi-polygon with holes**:
```ts
polygons: Array<{ outer: Vertex[]; holes?: Vertex[][] }>
```
B) **Flat ring array with even-odd fill**:
```ts
rings: Vertex[][]  // first ring outer, alternating inside/outside via even-odd
```

A is more explicit and matches how designers think ("this part has 2 disjoint regions, the right one has a window cut out"). B is more compact and matches SVG fill semantics.

Recommendation: A. Implementation cost is the same; designer cognitive load is lower.

Migration: existing `polygon: Vertex[]` becomes `polygons: [{ outer: <existing> }]` — a one-pass `parts.json` rewrite during the change.

### D3. Item 3 vs. Item 4 — pipeline vs. content source

Item 3 (per-option custom textures) and Item 4 (AI generation) are not competitors. Item 3 is the **pipeline**: a new field `customTextureUrl` + a new `seed:custom-textures` step that picks up designer-authored or AI-generated finish renders. Item 4 is one possible **content source** for that pipeline.

Concrete plan:
1. Land Item 3 first (small dev cost, immediate use for designer-authored renders).
2. Run Item 4 spike independently.
3. If spike succeeds, the AI output drops into the same `resources/finishes/<partId>/<optionId>.jpg` directory the Item 3 pipeline reads from — no further pipeline change needed.

### D4. Item 5 — prefer customer-side re-render

The supplied perspective renders have an off color cast. Two paths:

A) Customer re-renders with corrected output (correct LUT / color profile).
B) We apply server-side color correction (sharp `.modulate()` / `.linear()` / ICC handling) at seed time.

A is the right answer because the render IS the source of truth for the part-mask cuts; correcting downstream means every variant + every option asset needs the same correction applied consistently, which is fragile. Ask the customer first.

If customer can't / won't re-render: implement A (one-line sharp call in `cut-base-variants.mjs`); ~2 h.

## Risks / Trade-offs

- **[Risk] Item 1+2 schema migration breaks existing `parts.json` if not done atomically.** → **Mitigation**: include the migration step in the same change; the loader accepts both shapes for one release; designers re-run /dev/trace to author the new shape.
- **[Risk] Item 3's per-option renders dramatically multiply asset count** (e.g. 30 door-panel options × 1 render each = 30 PNGs just for ⑩). → **Mitigation**: bbox-cropped + LFS-tracked, same pattern as base-variant cuts. Estimate: ~30 × 100 KB = 3 MB per heavily-optioned part. Tractable.
- **[Risk] Item 4 spike yields unusable output** (AI inpainting drifts in style, colors are off, edges wrong). → **Mitigation**: time-box the spike at 1 week; have a fallback (designer-authored renders via Item 3 alone) ready.
- **[Trade-off] Bundling Item 1 + Item 2** vs. shipping them separately. Bundling is faster total but riskier (more code in one PR). Recommended bundle since both touch the same files.

## Migration Plan

This change has nothing to migrate. Each follow-up change has its own migration:

- `add-multiring-polygons` (1+2): one-pass `parts.json` rewrite to wrap each polygon in `{ outer: <existing> }` and convert `polygon` field name to `polygons`. Loader accepts both shapes for one release.
- `add-per-option-finish-renders` (3): pure addition — existing options without `customTextureUrl` are unaffected.
- (4 — spike, no migration)
- (5 — customer re-render or one-line correction, no migration)

## Open Questions

- **Q1**: Is Item 5 (background color) blocking the demo? If yes, prioritize over Items 1-3. If no, schedule after Items 1+2+3.
- **Q2**: Should `/dev/trace` get a "import variant + cut" workflow so a designer can preview a base-variant cut before committing it to `finish-base-overrides.json`? Out of scope here; flagging for the future.
- **Q3**: For Item 3, the `customTextureUrl` lives in `finish-options.json` (regenerated by `seed:parts`). When seed:parts runs, it'd overwrite the field unless the script preserves it. → Add a "preserve `customTextureUrl` across seed:parts re-runs" requirement to `add-per-option-finish-renders`.
