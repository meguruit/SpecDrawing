## Context

The MVP (`add-material-presenter-mvp`) implemented a generic, axis-filtered material catalog with free Konva drag/drop on top of a procedural seed scene. The actual customer workflow is narrower and more structured: there is **one registered base perspective image** (the supplied `ベースパース.jpg`), every changeable surface is a **predefined numbered region** annotated on `部材対応番号-1.pdf` / `-2.pdf` / `-3.pdf` (parts ① – ⑰ across kitchen / lighting / entry / interior fittings / floor / accent storage / sash categories), and the per-part choices come from `部材リスト.xlsx` — a workbook containing two option-set sheets (`アーバンシー`, `レコリード`) where each numbered part lists 1 – ~30 named finish options (some with product codes such as `RD322STSA`, `XAI-3A-4516`, `TE` / `TF` / `XP` …).

This change re-anchors the spec around that real workflow. The existing `color-composition` mask + shading pipeline from the MVP is the right primitive when the option is a colorway of a flat-painted/papered surface (e.g. ⑦ accent cloth, ⑫/⑮ floor, ⑰ sash frame). When the option swaps a material with grain, fixture geometry, or a printed pattern (e.g. ④ kitchen panel, ⑩ door panel, ⑤ range hood, ⑬ door panel B-XF), painting a HEX color is the wrong primitive — the option must be authored as a pre-rendered finish image clipped to the part mask. The redesign therefore generalizes "color override" into "finish selection" with two declared render modes.

**Source files staged in this change** (real, not procedural):

```
resources/base/ベースパース.jpg                     3.8 MB   default registered perspective
resources/reference/部材対応番号-1.pdf              1.3 MB   parts ⑦ ⑨ ⑩ ⑬ annotated
resources/reference/部材対応番号-2.pdf              1.2 MB   parts ⑫ ⑭ ⑮ ⑯ ⑰ annotated
resources/reference/部材対応番号-3.pdf              1.7 MB   parts ① ② ③ ④ ⑤ ⑥ ⑧ ⑪ annotated
resources/catalog/部材リスト.xlsx                  16.9 MB   2 sheets, 89 embedded images, ① – ⑰
```

`resources/` is the staging area for designer-supplied source files; runtime assets live under `public/` and are produced by seed scripts.

## Goals / Non-Goals

**Goals:**
- One canonical, registered base perspective with the supplied JPG as default.
- Numbered-part overlay (① – ⑰) modeled as data, hit-testable on the canvas.
- Finish options per part sourced from `部材リスト.xlsx`, with sheet selection (`アーバンシー` / `レコリード`).
- Reuse the MVP's `mask × shading × color` pipeline for color-mode parts; introduce a clean texture-overlay path for image-mode parts.
- Reproducible asset pipeline: one `npm run seed:parts` re-derives `public/catalog/finish-options.json` and finish swatch/texture assets from the staged xlsx.
- Keep the app a single Next.js tier (no backend) — the MVP's D10 decision still holds.

**Non-Goals:**
- Authoring UI for parts or finishes (designers edit `parts.json` and finish images by hand or via the seed script).
- Runtime PDF parsing (PDFs are reference inputs; tracing happens once, offline).
- Multi-perspective gallery / scene switching UI (registry supports it; UI ships with one).
- Saved projects, auth, multi-user (still session-only).
- Server-side print rendering / 2840×2000 PDF (still client PNG export).

## Decisions

### D1. Repository layout for source vs. runtime assets

Adopt a two-tier convention:

```
resources/                         # designer source-of-truth (staged in repo)
  base/<scene-id>/<file>           #   ← raw perspective JPG
  reference/<part-pdf>             #   ← annotated PDFs (designer reference)
  catalog/<workbook>.xlsx          #   ← option workbook(s)

public/                            # runtime, served by Next.js
  assets/base/<scene-id>/{base.jpg,parts.json,mask_<n>.png,shading_<n>.png}
  assets/finishes/<part-id>/<option-id>.{png,jpg}   # texture-mode finish images
  catalog/scenes.json
  catalog/finish-options.json      # generated from xlsx by `npm run seed:parts`
```

**Why:** The supplied PDFs and xlsx are designer artifacts that don't belong in the static-served `public/` tree (they're huge and not what the browser fetches). Keeping a `resources/` directory makes the provenance explicit and the seed scripts reproducible.

**Alternatives considered:**
- Put everything under `public/`: rejected — bloats the served bundle path, pollutes the URL space, and conflates source with runtime.
- Keep sources outside the repo (Drive only): rejected — breaks reproducibility; new contributors couldn't re-run the seed.

### D2. xlsx handling and size

The supplied `部材リスト.xlsx` is 16.9 MB, mostly because of 89 embedded images (one per finish option). Two sub-decisions:

- **Source-of-truth**: commit the xlsx under `resources/catalog/` because (a) the MVP repo already includes ~1 MB demo PNGs in `public/` so the absolute size precedent isn't fully clean-room, and (b) without the xlsx the seed pipeline cannot regenerate options. Use **Git LFS** for `resources/catalog/*.xlsx` to keep the main repo lean. (Confirmed 2026-04-27.) Track via `.gitattributes`: `resources/catalog/*.xlsx filter=lfs diff=lfs merge=lfs -text`. Contributors must run `git lfs install` once per clone; the seed script fails fast with a clear error if it detects an LFS pointer file instead of the real xlsx.
- **Extraction**: the seed script (`scripts/extract-finish-options.mjs`) uses the `xlsx` package to read both sheets, walks rows ① – ⑰, and emits a normalized `public/catalog/finish-options.json` plus extracts each embedded image to `public/assets/finishes/<part-id>/<option-id>.png` via direct unzip of `xl/media/` cross-referenced with the sheet's `drawing.xml` anchors.

**Why xlsx (the npm package) over openpyxl/Python:** the rest of the toolchain is Node; adding Python introduces a second runtime requirement. `xlsx` reads cells fine; for image extraction we use Node's built-in `zlib`/`unzipper` since `xlsx` doesn't expose embedded media.

**Alternatives considered:**
- Hand-curated `finish-options.json` (no script): rejected — 89 entries with product codes is too error-prone, and re-syncing on workbook updates becomes manual toil.
- Convert xlsx → CSV per sheet, drop the xlsx: rejected — loses the embedded swatch images that are the whole point of the workbook.

### D3. Numbered-part data model

Each part is a record in `parts.json` (per scene):

```ts
type Part = {
  id: string;           // "01" .. "17" (zero-padded; UI may render as ① etc.)
  label: string;        // "キッチン天板"
  category: string;     // "キッチン" | "照明" | "玄関" | "室内建具" | "床材" | "収納アクセント" | "サッシ"
  sourcePdf: 1 | 2 | 3; // which 部材対応番号-N.pdf the marker is on
  marker: { x: number; y: number };       // numbered marker centroid in scene-pixel coords
  polygon: Array<[number, number]>;       // hit-test polygon (the colored outline on the PDF)
  renderMode: "color" | "texture";        // see D4
  mask: string;                           // "mask_01.png" relative to scene dir
  shading?: string;                       // "shading_01.png" — required iff renderMode === "color"
};
```

Hit-testing on the canvas uses the `polygon` (point-in-polygon) so the user can click anywhere inside the part outline, not just the small ① glyph. The polygon is also rendered as a dashed overlay when the part is hovered/selected, mirroring the colored outlines on the source PDFs.

**Why polygons over bounding rects:** several parts (range hood ⑤, hanging shelves ⑥, accent cloth ⑦) have non-rectangular footprints; bounding rects would either over-claim hits or require a separate hover affordance.

### D4. Finish render modes

Two modes, declared per part:

- **`color`** — the part's surface is a flat colorway (paint, paper, fabric, lacquered panel). The renderer reuses the MVP's pipeline:
  1. Draw `shading_<part>.png` on a dedicated `Layer`.
  2. Draw a full-scene `Rect` of the chosen color with `globalCompositeOperation="multiply"`.
  3. Draw `mask_<part>.png` with `globalCompositeOperation="destination-in"`.
  
  The MVP's two invariants (mask drawn last, one Layer per part) carry over verbatim. The chosen color is supplied by the finish-option entry's `colorHex` field (resolved by the seed script from the workbook's swatch image — average color of the central 50% of the embedded swatch).
  
  Applies to: ⑦ accent cloth, ⑫ entrance floor, ⑮ living-room floor, ⑯ accent storage cloth, ⑰ sash frame, and any future colorway-only part.

- **`texture`** — the part's surface changes material/grain/pattern (door panel veneers, tile patterns, fixture color/finish where the geometry of the fixture itself changes look). The renderer draws:
  1. `public/assets/finishes/<part-id>/<option-id>.png` (a pre-rendered finish image at scene resolution) on a dedicated `Layer`.
  2. `mask_<part>.png` with `globalCompositeOperation="destination-in"`.
  
  No shading multiply; the pre-rendered image is assumed to already include lighting consistent with the base perspective. (Authoring guidance for designers lives in `resources/reference/AUTHORING.md`.)
  
  Applies to: ④ kitchen panel, ⑤ range hood, ⑥ hanging-shelf hardware, ⑧ kitchen-base tile, ⑩ entry door panel, ⑬ interior door panel, ⑪/⑭ door hardware, etc.

A few parts (② kitchen indirect lighting on/off, ③ gas stove 2-burner / 4-burner) are **discrete fixture variants** rather than colorway or surface swaps. These are modeled as `texture` mode with the option image being the alternate fixture render. If a part is "no change" / "absent" (e.g. ② "光無し"), its option points at a transparent PNG with the same mask — equivalent to "show the base perspective unmodified for this part."

**Why two modes instead of forcing one:** forcing everything through `color` (HEX-tint the base) loses grain on wood-veneer doors; forcing everything through `texture` doubles the asset count for parts where five paint colors all share one base image. Two modes keep authoring effort proportional to what each part actually needs.

### D5. Finish-option data model

```ts
type FinishOption = {
  id: string;             // "01-china-marble-black" — slug from label
  partId: string;         // matches Part.id
  sheet: "アーバンシー" | "レコリード";
  label: string;          // "ﾁｬｲﾅ大理石(黒)"
  productCode?: string;   // "RD322STSA" / "TE" / etc., when the workbook has a code row
  thumbnailUrl: string;   // "/assets/finishes/01/01-china-marble-black.png" (small swatch)
  // exactly one of the next two is set, matching the part's renderMode:
  colorHex?: string;      // "#1F1F23" — present when renderMode === "color"
  textureUrl?: string;    // "/assets/finishes/01/01-china-marble-black.png" — present when renderMode === "texture"
};
```

The seed script extracts every option, computes `colorHex` for color-mode parts (from the embedded swatch image), and copies the embedded image for texture-mode parts.

### D6. Sheet selection (`アーバンシー` vs `レコリード`)

The workbook has two parallel option-set sheets that are intentionally **independent option sets per part** — every `(partId, sheet)` pair is treated as its own catalog, even when option labels look identical across sheets. This matches the workbook author's intent (confirmed 2026-04-27): the same numbered part can carry different finishes on different sheets, not just the obvious ⑮ floor difference. The active sheet is part of UI state (`activeOptionSheet`, default `アーバンシー`). Switching sheets:
- Filters the finish-options shown per part to those whose `sheet` matches.
- Preserves any current selection where the same `(partId, label)` exists in the new sheet; resets selections that don't (and surfaces a non-blocking toast naming the cleared parts).

**Why preserve where possible:** otherwise switching sheets to compare options nukes the user's in-progress configuration, which is a bad demo experience. Naming what got cleared keeps the behavior predictable.

**Why `(partId, sheet)`-scoped and not de-duplicated by label:** because labels can collide across sheets while pointing at different finishes (different product codes, different swatches). De-duplicating by label would silently merge distinct options. The seed script does not warn on cross-sheet identical entries — they are valid by design.

### D7. Selection UI: marker click vs. side-list

Both entry points are first-class:
- **Marker click on canvas**: each part's `marker` renders a numbered Konva `Group` (circle + number). Clicking it sets `selectedPartId` and opens the finish panel for that part. The polygon outlines on hover.
- **Side list**: a fixed sidebar lists parts grouped by category (matching the workbook's leftmost category cells: キッチン / 照明 / 玄関 / 室内建具 / 床材 / 収納アクセント / サッシ). Clicking an entry has the same effect as the marker click and additionally scrolls/centers the canvas view if needed.

**Why both:** the canvas is more intuitive for "what is this thing called?", the side list is more intuitive for "I want to change the floor" without hunting for the marker. Cost is small — both share the same store action.

### D8. Markers: show/hide toggle

When the user is comparing finishes, the numbered markers and dashed outlines get visually noisy. A "番号オーバーレイ" toggle in the top bar hides/shows them. Default = on for first-time clarity; user choice persists in the Zustand store but not across reloads.

### D9. Removed surfaces

These MVP surfaces are removed (not deprecated — there are no users):

- `components/catalog/CatalogPanel.tsx` (axis-filter UI) → deleted.
- `components/canvas/MaterialsLayer.tsx` (free-drop placed materials) → deleted.
- `lib/catalog/{schema,filter,load}.ts` axis filtering → replaced by `lib/finishes/`.
- `public/assets/materials/<id>/{thumb,placement}.png` directory → deleted.
- `public/catalog/materials.json` → replaced by `public/catalog/finish-options.json`.
- Drag handles, delete-on-DEL, position state on placed materials → gone (parts are fixed; nothing is draggable).

### D10. Backend / persistence: still none

Re-affirm the MVP's D10: single Next.js app, no backend, no DB, no API routes added by this change. State is Zustand only; export remains client-side PNG. The triggers that would force a backend (persistence of saved configurations, real catalog ingestion behind auth, server-side high-res PDF) are unchanged.

### D11. Migration sequencing relative to MVP

The MVP change is built but not yet archived. Two options:
- **(a) Archive MVP first, then apply this change.** Cleanest — MODIFIED deltas land against a stable `openspec/specs/` baseline.
- **(b) Apply this change before MVP archive.** Workable but requires treating the MVP change's specs as the de-facto live baseline when reading MODIFIED requirements.

Recommend (a). Note this in the implementation kickoff; either path produces the same end-state spec.

## Risks / Trade-offs

- **[Risk] xlsx → swatch color extraction is fragile.** Workbook swatches are photos with non-uniform backgrounds; a naïve average could produce muddy colors. → **Mitigation**: extract from the central 50% rectangle of each swatch image, then snap to the nearest sample if the result is within ΔE 5 of an existing palette entry; surface a warnings file (`finish-options.warnings.json`) listing options whose extracted color looked low-confidence so a designer can override them in `resources/catalog/finish-overrides.json`.
- **[Risk] Texture-mode finish images need to be authored at scene resolution and lighting.** A single mismatched render visibly breaks immersion. → **Mitigation**: ship `resources/reference/AUTHORING.md` with the source perspective dimensions, camera, and a sample finish authored end-to-end; the seed script verifies pixel dimensions and warns on mismatch.
- **[Risk] Polygon accuracy depends on tracing the PDF outlines by hand.** → **Mitigation**: tracing happens once per perspective; ship a small helper page (`/dev/trace`) that overlays a draft polygon on the base and lets a designer adjust vertices, exporting to `parts.json`. Out of scope for shipping the runtime — but recorded as the intended designer tool.
- **[Risk] xlsx is 16.9 MB; LFS friction.** → **Mitigation**: D2 picks LFS but allows direct commit as fallback. The xlsx changes rarely.
- **[Risk] Two-sheet selection adds state surface that the MVP didn't have.** → **Mitigation**: D6 spec is explicit — preserve selections by `(partId, label)`, toast what got cleared. One scenario in the spec covers each branch.
- **[Trade-off] Two render modes = more authoring discipline.** Designer must decide per part whether a colorway is enough or a texture image is required. The cost is real but the alternative (forcing one mode) produces visibly worse results for the other mode's natural cases (D4).
- **[Trade-off] Removing free-drop loses the "drop a chair onto a room" demo.** That demo wasn't a customer requirement; the customer requirement is per-part finish selection.

## Migration Plan

1. **Land sources** in `resources/{base,reference,catalog}/` (this change's first task) so the seed pipeline has inputs.
2. **Author the parts manifest** for the supplied perspective: trace polygons for parts ① – ⑰ from the three reference PDFs into `public/assets/base/main/parts.json`; produce `mask_<n>.png` (and `shading_<n>.png` for color-mode parts) under `public/assets/base/main/`.
3. **Ship the seed script** `scripts/extract-finish-options.mjs` and wire `npm run seed:parts`. Run it once, commit `public/catalog/finish-options.json` and the per-option finish images.
4. **Implement loaders + store** (`lib/parts/`, `lib/finishes/`, store updates).
5. **Replace UI**: build `PartMarkerLayer`, `PartFinishLayer`, `FinishOptionPanel`, sheet switcher, marker toggle. Delete the MVP catalog/material-drop UI per D9.
6. **Smoke-test** the full flow: load app → click marker ⑦ → pick "サンドベージュ" → wall recolors. Click ⑩ → pick "ｺｺﾅｯﾂﾁｪﾘｰ" → door panel swaps texture. Switch sheet → preserved/cleared selections behave per D6. Export PNG works.
7. **Archive the MVP change** (per D11(a)) before or in lockstep with archiving this change.

**Rollback**: revert the merge. Because there's no backend and no persistence, rollback is purely code; no data migration needed.

## Open Questions

_All resolved 2026-04-27 — recorded here for traceability:_

- **Q1 → Resolved**: Sheets are intentionally independent option sets per part (not just the ⑮ floor difference). The seed pipeline keeps every option `(partId, sheet)`-scoped and does not warn on cross-sheet label collisions. Reflected in D6.
- **Q2 → Resolved**: Serve `ベースパース.jpg` at native resolution under `public/assets/base/main/base.jpg`. No downscaling step in the seed pipeline. Customers judge fidelity on the real perspective.
- **Q3 → Resolved**: Use an explicit `none`-equivalent option in `finish-options.json` for parts where "no change" / "absent" is meaningful (② 光無し, ⑤ unchanged hood, etc.). The UI renders it as a normal chip; selecting it composites a transparent texture (texture-mode parts) or a sentinel `colorHex` whose multiply is a no-op against the base (color-mode parts). Already covered by `finish-spec-catalog` Requirement: Explicit "no change" option — no spec edit needed.
- **Q4 → Resolved**: Git LFS. `.gitattributes` tracks `resources/catalog/*.xlsx`; contributors run `git lfs install` once. Reflected in D2.
