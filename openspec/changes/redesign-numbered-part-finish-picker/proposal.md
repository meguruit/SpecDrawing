## Why

The MVP (`add-material-presenter-mvp`) shipped a generic, axis-filtered material catalog and a free-drop Konva canvas on top of a procedural seed scene. Real customer deliverables work very differently: there is **one registered base perspective image** (`ベースパース.jpg`), every changeable surface is a **fixed numbered region** annotated on `部材対応番号-1.pdf` / `-2.pdf` / `-3.pdf` (parts ① – ⑰), and the choices a user can make at each region are the **finish-spec rows in `部材リスト.xlsx`** — not arbitrary catalog entries dragged onto the scene. The MVP's drag-drop / multi-axis-filter model cannot represent this workflow, so the spec is being restructured to match how customers actually pick a finish per numbered part on a registered perspective.

## What Changes

- **BREAKING**: Replace "user picks a base scene + drops materials" with "system serves a registered base perspective + user picks a finish for each numbered part." The free-drop catalog UI and multi-axis filters are removed.
- **BREAKING**: The unit of choice changes from "catalog entry with axes" to "finish option for a specific numbered part" (where the part is one of ① – ⑰ as annotated on `部材対応番号-*.pdf`).
- Register a base perspective image in the app, with the supplied `ベースパース.jpg` as the default. The asset is staged under `resources/base/` and published to `public/assets/base/<scene-id>/base.jpg` for runtime.
- Define a numbered-part overlay for the registered perspective. Parts ① – ⑰ from `部材対応番号-1.pdf` / `-2.pdf` / `-3.pdf` are encoded as a `parts.json` manifest (id, label, category, source-pdf, polygon, mask filename). The annotated PDFs themselves are staged under `resources/reference/` for designer reference.
- Source the per-part finish options from `部材リスト.xlsx` (sheets `アーバンシー`, `レコリード`). The xlsx is staged under `resources/catalog/` and a build/seed step extracts a normalized `public/catalog/finish-options.json` keyed by part id, plus per-option swatch/texture assets under `public/assets/finishes/<part-id>/<option-id>.{png,jpg}`.
- New UI flow: user (a) sees the registered perspective, (b) selects a numbered part — by clicking the numbered marker on the perspective or by picking it from a side list — and (c) chooses one of that part's finish options; the perspective updates immediately to reflect the chosen finish for that part.
- A finish option resolves to one of two render modes: **(i) color-composition** (re-uses the MVP's `mask × shading × color` pipeline when the option is a colorway of an otherwise unchanged surface, e.g. wall accent cloth ⑦, floor ⑮, sash frame ⑰) or **(ii) texture/image swap** (overlay a pre-rendered finish image clipped by the part mask, for cases where the option changes material/grain, e.g. door panel ⑩, kitchen panel ④). The render mode is declared per part in `parts.json`.
- Allow switching between catalog sheets (`アーバンシー` / `レコリード`) at runtime so the same numbered overlay can serve multiple option sets.
- Asset staging convention: customer-supplied source files live under `resources/{base,reference,catalog}/` (kept out of `public/` because they are sources, not runtime assets); a documented seed/build step transforms them into the `public/` runtime layout. `resources/` is added to the repo (with `resources/catalog/*.xlsx` and `resources/base/*.jpg` either committed or fetched on demand — see design.md for the size/LFS decision).

Explicit non-goals for this change (still deferred):

- No server-side persistence of user selections; selections live in the Zustand store and are reset on reload.
- No editing / authoring UI for parts (the `parts.json` and mask images are produced offline by a designer / the seed script).
- No PDF parsing at runtime — the `部材対応番号-*.pdf` files are reference inputs only; a one-time tracing step produces the part polygons/masks.
- No multi-perspective gallery in this change — exactly one registered perspective (the supplied default) is required to ship; the registry is designed so additional perspectives can be added later without a spec change.
- No support for per-user / per-project saved configurations (still single-session).

## Capabilities

### New Capabilities
- `base-perspective-registry`: A registry of one or more base perspective images, with one designated as the default that loads on app start. Backed by `public/assets/base/scenes.json` and per-scene `scene.json` manifests.
- `numbered-part-overlay`: For each registered perspective, a manifest of numbered parts (① – ⑰) — id, label, category, source-PDF reference, polygon (for hit-testing the numbered marker), mask image, and declared render mode (`color` or `texture`).
- `finish-spec-catalog`: A normalized, sheet-aware catalog of finish options per numbered part, derived from `部材リスト.xlsx`. Supports multiple option-set sheets (e.g. `アーバンシー`, `レコリード`) and exposes per-option metadata (label, product code, swatch/texture asset, render-mode hint).

### Modified Capabilities
- `material-catalog`: Repurposed from a generic axis-filtered catalog to a thin "finish-options-by-part" lookup over `finish-spec-catalog`. The multi-axis filter UI and `axes` schema are removed.
- `presentation-canvas`: Replaces free-drop material placement with numbered-part selection on a registered base perspective. The canvas no longer accepts arbitrary catalog drops; it renders the base + per-part finish layers and exposes click/select on numbered markers.
- `color-composition`: Generalized so each numbered part declares whether its finish layer is a `color` composition (existing `mask × shading × color` pipeline) or a `texture` overlay (mask-clipped pre-rendered image). The shading-then-multiply-then-mask invariants from the MVP are preserved for the `color` mode.

## Impact

- **Codebase**: New `lib/parts/` (parts manifest loader & types), new `lib/finishes/` (finish-options loader & types), new `components/parts/PartMarkerLayer.tsx` and `components/parts/PartFinishLayer.tsx`, new `components/finishes/FinishOptionPanel.tsx`. Existing `components/catalog/CatalogPanel.tsx`, `components/canvas/MaterialsLayer.tsx`, `lib/catalog/{schema,filter,load}.ts`, and the free-drop interaction in `CanvasStage.client.tsx` are removed or substantially reduced.
- **State**: Zustand store gains `selectedPartId`, `partFinishSelections: Record<PartId, FinishOptionId>`, `activeOptionSheet`. Removes `placedMaterials`, `axisFilters`, `partColors` is generalized into `partFinishSelections`.
- **Assets / repo layout**: New top-level `resources/` directory holds customer source files (`resources/base/ベースパース.jpg`, `resources/reference/部材対応番号-*.pdf`, `resources/catalog/部材リスト.xlsx`). A new seed script (`npm run seed:parts`) reads the xlsx and emits `public/catalog/finish-options.json` plus finish swatch/texture assets; an existing-style script extends `npm run seed:assets` to also produce the per-part masks. The `部材リスト.xlsx` is ~16 MB (89 embedded images) — the design decides whether it is committed as-is, committed via Git LFS, or fetched out-of-band.
- **Dependencies**: Add `xlsx` (for the seed script's xlsx → JSON extraction) as a devDependency. No new runtime deps.
- **Existing dependencies**: `konva`, `react-konva`, `zustand`, `zod`, `sharp` (devDep), `tailwindcss` continue to apply.
- **Encoding**: UTF-8 throughout (xlsx is UTF-8 internally; the seed script normalizes any half-width katakana labels as-is).
- **MVP relationship**: This change supersedes core capabilities of the unarchived `add-material-presenter-mvp` change. Recommended sequencing: archive the MVP first so this change's MODIFIED deltas land against a stable `openspec/specs/` baseline. If the MVP is not archived, treat its proposal/specs as the de-facto live baseline for the purpose of these deltas.
- **Backward compat**: None. The MVP is a demo; there are no production users to migrate.
