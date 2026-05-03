## Context

`add-urban-sea-variants-and-parts-export` shipped runtime variant switching, per-variant texture lookup (`textureUrlByVariant`), Excel spec-sheet export, and the seed pipeline that emits `_v_<variantKey>.png` per part. Walking the live demo with the designer surfaced three specific gaps the seed pipeline can't solve from the workbook alone: column-to-variant misassignments, alternative options that render as flat color instead of grain-following, and special-case rendering for *無* (off-state) and `colorHex` palettes that need to track the variant base.

The runtime renderer already has the right hooks (`textureUrlByVariant` for texture-mode, a single `colorHex` path for color-mode, the variant switcher driving `activeVariantKey`). All three gaps are addressable at the **seed-pipeline + config layer** plus a 1-line runtime change to read `colorHexByVariant[activeVariantKey]` when present.

## Goals / Non-Goals

### Goals

- Allow the designer to override per-variant assignments without re-editing `部材リスト.xlsx` (workbook is source of truth for the option **set**, not for the variant **mapping**).
- Make alternative options on grain-heavy parts (⑩, ⑬, ⑮) visually convey the alternative's color while keeping the chosen base finish's grain detail.
- Visually erase ② キッチン間接照明 when the user picks *無*.
- Let ⑰ サッシ枠 carry per-variant `colorHex` values so the sash blends with each base perspective.
- Audit ⑩ / ⑪ / ⑬ / ⑭ / ⑮ / ② / ⑰ data so `label`, `iconUrl`, and rendered texture all describe the same finish.

### Non-Goals

- Adding a test framework (deferred — separate change).
- Touching parts not on the 7-part list (01, 03–09, 12, 16).
- Improving `レコリード` (out of scope; some overrides may be useful there later but the current customer demo is `アーバンシー`).
- Replacing the workbook as the source of the **option set**. Overrides only re-assign or synthesize within the existing set.

## Decisions

### Decision 1: Variant-mapping override config (vs. workbook fix)

**Choice:** Add `resources/catalog/finish-variant-mapping.json`. Apply at seed time AFTER workbook parsing, before emit.

**Why not just fix the workbook:** The customer is the source of the workbook. Round-tripping every variant-mapping correction through the customer is slow, and the customer doesn't always know which workbook label maps to which variant intent (Natural/Flat/Sharp is a designer concept, not a customer concept). A designer-owned override config lets us iterate quickly without blocking on the customer.

**Override semantics:**
- For each `(partId, variantKey, optionLabel)` triple: find the option whose `(partId, sheet=アーバンシー, label=optionLabel)` matches; set `defaultForVariants` so it claims `variantKey` (adding to its array).
- Any other option that previously claimed that `variantKey` for the same partId+sheet has the key REMOVED from its `defaultForVariants` (becomes an alternative).
- Multiple variants pointing at the same label (e.g. ⑭ Natural+Flat→シルバー) collapse: the named option claims all named variants. This already mirrors the workbook's same-label collapse rule.
- Apply `crossValidateOverridesAgainstScene`: every variant key referenced MUST exist in the active scene's `variants` array; every option label MUST exist on the part (or be synthesizable, see Decision 2).

### Decision 2: ⑭ ブラック synthesis (workbook gap)

**Problem:** Override says `14.sharp = "ブラック"`, but `アーバンシー` sheet for ⑭ has only `シルバー`.

**Choice:** Synthesize the missing option by **copying** the same-label option from a sibling sheet on the same part — `レコリード` ⑭ has `ブラック`. Fall back to `missing-overridden-option` warning when no sibling-sheet option exists.

**Why copy vs. authoring inline:** Copying preserves the option's icon, productCode, and any subLabel without inventing them. The synthesized option carries `synthesized: true` for traceability. If the customer later adds ブラック to the `アーバンシー` sheet, the seed step prefers the workbook entry and stops synthesizing.

**Alternative considered:** Authoring synthetic options inline in the override config. Rejected — duplicates fields that the seed already extracts cleanly from the workbook elsewhere, invites drift.

### Decision 3: Tint-base monotone formula

**Choice:** Linear sRGB luminance (`Y = 0.2126·R + 0.7152·G + 0.0722·B`) for the monotone, multiply with the icon's mean non-white sRGB color, store as 8-bit sRGB. No gamma conversion.

**Why linear sRGB instead of perceptual L\*:** Linear is fast (one matrix multiply per pixel), matches what `sharp.greyscale()` produces by default, and the visual difference vs. perceptual luminance is small (<3% in the regions we care about). Perceptual L\* would require sRGB→XYZ→Lab and back — added complexity for marginal fidelity gain.

**Why mean non-white vs. dominant cluster:** The icons are 96×96 swatches with little texture; the mean of non-white pixels closely tracks the swatch's intent color. Dominant-cluster (e.g., k-means k=3) would be more robust on highly-textured icons but the icons in this dataset are flat swatches. Documented for revisit if a future part needs it.

**Alternatives considered:**
- Manual color picks per option (rejected — 50+ options × 3 parts is too tedious).
- Photoshop-style "color overlay" with screen blend instead of multiply (considered; multiply preserves the dark grain bands, screen washes them out; multiply matches what wood-grain finishes actually look like under different stain colors).

### Decision 4: ② *無* ambient-fill width

**Choice:** 16 px outward dilation of the part mask, sample mean RGB inside the resulting ring.

**Why 16 px:** ② キッチン間接照明 is a thin strip ~12 px wide on the unscaled scene; the surrounding ceiling is roughly uniform within ~30 px of the strip. 16 px sits in the middle — wide enough to dampen sample noise, narrow enough to stay on the same surface (doesn't bleed into adjacent parts like ① countertop or ③ range hood).

**Alternative considered:** Per-pixel inpainting (PatchMatch / blur-then-fill). Rejected — adds a meaningful image-processing dependency for a single special-case option. The solid-fill approximation is acceptable because the indirect-lighting bloom is itself a soft, low-detail effect and a flat sample from the same ceiling reads as "the lighting is off".

### Decision 5: `colorHexByVariant` runtime fallback

**Choice:** New optional field on color-mode options. Schema:

```ts
colorHexByVariant: z
  .object({
    natural: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    flat: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    sharp: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  })
  .partial()
  .optional()
```

Runtime resolves: `option.colorHexByVariant?.[activeVariantKey] ?? option.colorHex`.

**Why not require all-keys-present:** The variant set is scene-defined; making it `partial()` lets a designer override only one or two variants and inherit the static `colorHex` for the rest.

**Why not auto-derive from variant base:** The first revision will hand-curate via the helper script `scripts/suggest-sash-palette.mjs` (samples background near sash mask, prints suggested hex values for each variant + each option). Auto-derivation can land later if the curated values prove tedious to maintain.

### Decision 6: Tint-base PNG output naming

**Choice:** `<partId>/<optionId>__<variantKey>.png` — three byte-identical files per alternative.

**Why three identical files instead of one shared:** `textureUrlByVariant[v].url` is the runtime contract. Returning the same URL for all three variants would technically work but breaks the cache-bust convention (one URL → one `?v=<rev>`), and means a future per-variant tint (e.g., warmer tint on Natural, cooler on Sharp) couldn't be wired without renaming. Three files keeps the URL-per-variant invariant.

**Storage:** ~30 KB per PNG, ~3 variants × 50 alts × 3 parts = 450 files × 30 KB = ~13 MB. Same order of magnitude as today's `_v_<variantKey>.png` files. Acceptable.

### Decision 7: Order of seed steps

**Choice:** `seed:parts → seed:variants` unchanged, but `seed:variants` now does (in order):
1. Original per-part `_v_<variantKey>.png` cropping.
2. Apply variant-mapping overrides (mutate `defaultForVariants` on emitted options; synthesize cross-sheet options if needed).
3. Tint-base loop for alternatives on tint-base-declared parts.
4. Ambient-fill loop for `noEffect` options.
5. Re-derive `textureUrlByVariant` per option (overrides take precedence over auto-derivation).

The `seed:parts` step stays workbook-only and emits the unmodified option set + icons. All variant-mapping logic lives in `seed:variants` so the workbook→options pipeline stays simple and the override config has one application point.

## Risks / Trade-offs

- **Override drift**: if the customer later corrects the workbook, the override may silently mask a fix. **Mitigation**: the seed step logs every active override at startup so a comparison is easy.
- **Tint-base color accuracy**: dominant-color extraction could pick the wrong color on multi-color swatches (rare in this dataset, common in some catalogs). **Mitigation**: emit a `tint-color-low-confidence` warning when the icon's color variance is high; document a per-option color override slot for escapes.
- **Synthesized option for ⑭**: if `レコリード` later changes its `ブラック` definition, アーバンシー inherits the change automatically — could be either desired or surprising. **Mitigation**: the synthesized option logs its source sheet on every seed run; designer can copy-and-pin it into the override config when stability matters.
- **Cache-bust on regenerated assets**: tint-base regeneration changes asset bytes; `_rev` already cache-busts. Confirmed working in `add-urban-sea-variants-and-parts-export`.

## Migration Plan

1. Land the schema change (`colorHexByVariant`, optional new fields) — backwards compatible, no asset regeneration needed yet.
2. Add the variant-mapping config with the four override blocks (⑩ ⑪ ⑬ ⑭) and the ⑭ synthesis path; rerun `seed:parts → seed:variants`. Verify ⑩/⑪/⑬/⑭ now show correct labels per variant in the UI.
3. Add the tint-base block (⑩ ⑬ ⑮); rerun `seed:variants`. Verify alternatives now show grain-following tint in the UI.
4. Add the `noEffect` block for ②; rerun `seed:variants`. Verify *無* visually erases the lighting bloom.
5. Run `scripts/suggest-sash-palette.mjs` for ⑰; designer curates `colorHexByVariant`; commit and verify all 4 sash colors look right under each variant base.
6. Run a per-part visual audit on the 7 affected parts; fix any remaining `(label, icon, texture)` divergences via the override config.

Each step is independently verifiable, so the change can ship in stages if needed.

## Open Questions

- Should `tintBase` also support a per-option override (e.g., one alt that's not wood-grain at all should opt out of tint-base and use its swatch directly)? Defer to first sighting; for now an alt can opt out by being listed as a variant claimant in `variantOverrides`.
- Should `colorHexByVariant` also be expressible at the part level for color-mode parts (so all options inherit a per-variant hex shift)? Defer; ⑰ is the only known use case and per-option is fine there.
- ⑭'s synthesized `ブラック` — should it appear on the `アーバンシー` sheet's option chip list, or only as the Sharp default (hidden chip)? Default to: appear on the chip list so users can flip back. Revisit if it confuses the chip layout.
