## Context

The runtime composes finishes as `base.jpg + per-part finish layer`, where the per-part finish is either:
- color mode: `shading_<id>.png × colorHex × mask_<id>.png` (multiply + destination-in)
- texture mode: `texture.png × mask_<id>.png` (destination-in only)

Workbook swatches from `部材リスト.xlsx` work fine for many parts, but fail for fixture-heavy parts where the finish swap involves more than just a colorway: range-hood color, kitchen-panel material, ceiling-light hardware finish, entry-floor tile pattern, etc. The customer is rendering the same scene multiple times with different material packs (a "natural" pack, a "sharp" pack with black hardware, a "flat" pack for the entry floor) and wants the runtime to splice in the relevant region of the relevant render based on which option the designer picked.

The cleanest place to do that work is the seed pipeline: for each `(partId, optionLabel)` in an override config, load the variant base, mask it, and write the result as the option's existing `textureUrl`. The runtime needs no change — it already paints `texture × mask` for texture-mode parts.

This change does NOT introduce a new render mode. It expands what the existing texture mode points at: previously a workbook swatch (small, stretched), now a scene-resolution piece cut from a variant base.

## Goals / Non-Goals

**Goals:**
- Single source of truth for the override map (`resources/catalog/finish-base-overrides.json`), designer-editable.
- Variant base files live alongside the natural base under `resources/base/` with a clear `<scene>_<variant>.jpg` naming convention.
- The seed pipeline degrades gracefully when variant bases are missing — the app keeps rendering and the warnings file points the designer at what to upload.
- Re-running the seed pipeline is idempotent and incremental: only options whose source (variant base or mask) changed need re-cutting.
- Runtime is unchanged.

**Non-Goals:**
- No runtime UI for editing the override map.
- No automatic detection of which option corresponds to which variant — the map is explicit.
- No per-sheet override differentiation (same `(partId, optionLabel)` → same variant on every sheet).
- No mask-based blending across variants for a single option (each option resolves to exactly one variant).
- No production-time use of the dev API or seed scripts (all variant cutting happens at seed time, output is committed under `public/`).

## Decisions

### D1. Variant identification: bare keys, not full filenames

A variant is identified by a short key like `natural`, `sharp`, `flat`. The runtime URL is constructed as `public/assets/base/<scene-id>/base_<variant>.jpg`. The Japanese-named source file lives at `resources/base/ベースパース_<variant>.jpg`. The seed pipeline knows to copy / use the source file for the named variant.

**Why**: keeps the override config terse (`"sharp"` vs `"resources/base/ベースパース_sharp.jpg"`) and decouples the override map from filesystem layout.

### D2. Override config shape

```json
{
  "version": 1,
  "overrides": {
    "01": {
      "ﾁｬｲﾅ大理石(黒)": "sharp",
      "ﾁｬｲﾅ大理石(白)": "natural"
    },
    "05": {
      "ブラック": "sharp",
      "ホワイト": "natural"
    },
    ...
  }
}
```

Per-part keyed by option label. Same mapping applies to every sheet (`アーバンシー`, `レコリード`, …) — if a sheet has the same option label, it gets the same variant. If a sheet doesn't have the label, no override (the option keeps its previous behavior).

**Alternatives considered:**
- Flat keyed by `<sheet>:<partId>:<optionLabel>`: more verbose; rarely needed in practice. Can be added later if a sheet-specific override emerges.
- TypeScript constant in the seed script: harder for designers to edit.

### D3. Seed step: `scripts/cut-base-variants.mjs`

Inputs:
- `resources/catalog/finish-base-overrides.json`
- `resources/base/ベースパース_<variant>.jpg` for each referenced variant
- `public/assets/base/main/scene.json` (dimensions)
- `public/assets/base/main/parts.json` (mask filenames per part)
- `public/assets/base/main/mask_<id>.png` for each overridden part
- `public/catalog/finish-options.json` (current options)

Output:
- `public/assets/finishes/<partId>/<optionId>.png` for each successfully cut option (overwriting the workbook-swatch placeholder)
- `public/catalog/finish-options.json` updated `textureUrl` for those options
- `public/catalog/finish-options.warnings.json` appended with `{ kind: "variant-missing" | "no-matching-option", … }` entries for options the script could not satisfy

Per-option algorithm:
1. Look up the variant base file. If absent → emit `variant-missing` warning, skip.
2. Find every option entry in `finish-options.json` whose `partId` matches and whose `label` matches (across all sheets). If none → emit `no-matching-option` warning, skip.
3. Load the variant base as raw RGB at scene resolution (resize if dimensions don't match exactly, with a warning).
4. Load the part's `mask_<id>.png` as raw alpha.
5. Compose: pack `(variantBase.RGB, mask.alpha)` into RGBA, write as PNG to the option's `textureUrl` path.
6. For each affected option, set `textureUrl` to the new path, mark `_source: "base-variant:<variant>"` (a soft annotation in the warnings file for designer traceability — not in finish-options.json schema).

The script is idempotent: re-running with the same inputs produces the same outputs. Adding a variant base mid-development simply turns previous warnings into successful cuts.

**Why pre-cut and store as PNG** (rather than compose on the fly at runtime): keeps the runtime unchanged, ships a 1:1 cache-bustable asset that fits naturally into the existing texture-mode pipeline, and lets the seed script handle dimension mismatches / warnings cleanly.

### D4. ⑫ 玄関床 render-mode flip from `color` → `texture`

⑫ has three workbook options. With variant overrides in place, each option needs a scene-resolution texture cut from its variant base — not a HEX color tint. Switching to `texture` mode is unavoidable.

The existing `shading_12.png` (real luminance from base.jpg) becomes orphaned. We don't delete it — it's small, the dev API doesn't reference it after the renderMode flip, and a designer might revert if they later want a color-mode workflow back. (Could be deleted as a follow-up.)

### D5. Pipeline order and CLI surface

```
npm run seed:parts      # xlsx → finish-options.json + per-option workbook swatches
npm run seed:masks      # parts.json → mask + shading PNGs (incremental via dev API sidecar
                        # OR full rebuild if invoked from the script)
npm run seed:variants   # base variants + override config → per-option cropped textures,
                        # finish-options.json updated in place
```

`seed:variants` runs LAST so it can overwrite the workbook-swatch textures from `seed:parts` for overridden options. Order is documented in `resources/reference/AUTHORING.md` (already present; updated as part of this change).

**Independence**: each step can be rerun without the others. If the override map changes, run `seed:variants` only. If a polygon changes, `seed:masks` (handled by the dev API auto-regen) plus `seed:variants` to re-cut anything that depended on that mask.

### D6. Missing-variant fallback

When a variant base file is absent:
- Script does not crash; emits a `variant-missing` warning per affected option.
- The option's `textureUrl` is left at whatever it was after `seed:parts` (i.e., the workbook swatch).
- The runtime continues to render the workbook swatch — visually wrong, but the app stays usable.
- Once the variant base lands and `seed:variants` is rerun, the swatch is replaced with the cropped piece.

This is the MVP-friendly degradation: ship the pipeline now, crop happens when assets arrive.

### D7. Cache-bust integration

The cropped textures land at the same `textureUrl` path the runtime already cache-busts via per-option content. Since the runtime's `_rev` for masks is computed from polygon + mask filename + shading filename (D13 of the dev-trace change), and the mask doesn't change when only the texture changes, mask-URL cache-bust does NOT invalidate the texture URL.

Workaround: the runtime ALSO cache-busts texture URLs. We extend the cache-bust hash to include the texture filename — but textureUrl already varies per option id, so different options DO get different URLs.

What about the SAME option's textureUrl having different content after a re-run of `seed:variants`? The URL stays the same; the file content changes. Browser cache + useImageCache could serve stale.

**Decision**: extend `loadFinishOptions` (or the runtime FinishOption shape) so each option carries a `_rev` derived from its rendered textureUrl content (or a sidecar `finish-options.json` mtime). On the next reload of `/`, texture URLs become `<url>?v=<rev>` and refetch the latest crop.

**Simpler**: bump a global `finish-options.json` revision (mtime or content hash) and append it to every texture URL. Reasonable since a re-run of `seed:variants` invalidates the whole catalog file at once.

We'll use the simpler "global option-catalog revision" approach. `loadFinishOptions` returns `{ options, _rev }`; runtime appends `?v=<_rev>` to every textureUrl.

## Risks / Trade-offs

- **[Risk] Variant base files might have slightly different dimensions / camera** despite the customer's intent. → **Mitigation**: the seed script asserts dimensions match scene.json; on mismatch, resize-to-fit with a warning. The mask is the same pixel grid, so a slight offset between renders bleeds into the cropped piece's edges. Designer fixes by re-rendering at the canonical resolution.
- **[Risk] Large public/ growth** if variants × overrides multiply (3 variants × 13 overrides ≈ 39 PNG files, each potentially 1-3 MB). → **Mitigation**: PNGs are mask-clipped to small regions (most parts are ≪ 100×100 to 1000×1000 px), and `sharp` PNG output with `compressionLevel: 9` is small. Estimated total < 30 MB. LFS still applies via the existing `public/assets/finishes/**/*.png` pattern.
- **[Risk] Override config drift from finish-options.json** — designer edits an option label, override stops matching. → **Mitigation**: warnings file flags `no-matching-option` entries on every `seed:variants` run; designer reviews.
- **[Trade-off] Pre-cut PNGs vs runtime composition.** Runtime composition would let us swap variants without re-running the seed script, but every option would mount 3-5 layers (base + variant slice + mask, per overridden option) — Konva's "≤ 5 layers" performance guidance breaks. Pre-cutting at seed time keeps the runtime pristine.
- **[Trade-off] Per-part-keyed override (vs sheet-aware)** loses sheet-specific overrides. We'll cross that bridge when a sheet wants different variants for the same `(partId, label)`.

## Migration Plan

1. Land the renames + scene.json update in one commit (no functional change yet).
2. Add `resources/catalog/finish-base-overrides.json` with the 13 mappings from the proposal table.
3. Add `scripts/cut-base-variants.mjs` and `npm run seed:variants` script.
4. Flip ⑫ render-mode in `parts.json` from `color` → `texture` (and remove `shading: "shading_12.png"`).
5. Run `seed:variants` once; commit the generated `public/catalog/finish-options.json` updates and any successfully cut PNGs (initially: only `natural` variant cuts succeed because `sharp` and `flat` files don't exist yet; warnings list the missing variant bases).
6. Document the override workflow in `resources/reference/AUTHORING.md`.
7. Smoke-test: pick options on `/` for an overridden part with `variant=natural`; verify the cropped piece renders correctly. Verify a missing-variant option falls back to its previous workbook swatch (not a broken image).
8. When the customer supplies `ベースパース_sharp.jpg` and `ベースパース_flat.jpg`, drop them into `resources/base/`, run `seed:variants`, commit the new PNGs and updated `finish-options.json`. No code changes.

Rollback: revert the merge. The variant cutter is opt-in via the override config; if the config is empty or removed, the script no-ops and the catalog reverts to workbook swatches.

## Open Questions

- **Q1**: The customer-supplied `ベースパース_sharp.jpg` and `ベースパース_flat.jpg` haven't arrived yet. Ship the pipeline empty? **A**: Yes — D6 fallback. The pipeline is useful immediately for `natural` cuts and will activate fully when the files land.
- **Q2**: Should the orphaned `shading_12.png` be deleted in this change? **A**: No — small file, no runtime cost, easy to delete later if confirmed unused. Mention in tasks but don't enforce.
- **Q3**: Does the runtime need a separate "render mode" for variant-swap, or is texture-mode enough? **A**: Texture-mode is enough (D-rationale at the top of the design). Keeps the spec surface small and the runtime unchanged.
