## Why

After landing the base-variant cut pipeline (`add-base-variant-finishes`) the runtime is correctly splicing variant pixels into single, simply-connected polygon regions. Real customer scenes routinely break that single-polygon assumption (a "part" is often two physically-separate strips — left + right closet doors, multiple ceiling spotlights, two-bay range hood) and the current single-closed-polygon model can't represent them. There are also fidelity gaps on the texture side (door wood grains don't reproduce well from workbook swatches because the swatch is a small color sample, not the actual veneer at scene resolution) and a confirmed asset issue (the supplied background perspective renders with off colors that throw the whole composite). This proposal is a **scope memo** for the next pass — the items are listed here so the team can size them; concrete spec deltas + tasks land per-item once we decide which to ship and in what order.

## What Changes

This change is a **proposal-only scope memo**. Implementation is split into per-item follow-up changes (one change per scope item below) so each can be reviewed, sized, and merged independently. Each item links the eventual change name and lists the in-scope work.

### Item 1 — Multi-region polygon per part *(future change: `add-multipolygon-parts`)*

A single part SHALL be able to declare multiple disjoint polygon regions. Examples that don't fit today:

- ⑬ パネル ドレタスB-XF (closet doors) — two separate door slabs that are visually one "part" in the workbook
- ⑨ スポットライト — currently traced as one big bbox covering the entire ceiling track; a multi-region polygon could trace each spotlight cluster individually for tighter selection
- ⑥ 吊り棚金具 — left + right hanging shelf hardware

Spec impact:
- `numbered-part-overlay`: `polygon` field becomes `polygons` (array of polygons). Existing single-polygon parts migrate to a 1-element array.
- `lib/dev/regenAssets.ts` mask rasterizer: the union of all polygons is the alpha-true region.
- Hit-test (`PartMarkerLayer`): point-in-any-polygon.
- `/dev/trace`: a "ポリゴンを追加" button creates a new sub-polygon under the editing part; the side panel groups vertices by sub-polygon index.

### Item 2 — Polygon holes (e.g. sash frame, donut shapes) *(future change: `add-polygon-holes`)*

A single polygon SHALL be able to declare interior holes (rings to subtract from the outer ring). Examples:

- ⑰ サッシ枠 — the actual frame is a thin ring around the glass; today the polygon is a filled rectangle covering the glass too, so applying a sash-color tints the glass as well.
- Any "frame" or "border" finish (e.g. a picture frame, a doorway molding).

Spec impact:
- `numbered-part-overlay`: each polygon becomes `{ outer: vertices[], holes?: vertices[][] }`. Backwards-compat: bare `vertices[]` is treated as `{ outer }` with no holes.
- Mask rasterizer: even-odd fill rule (alpha 1 inside outer XOR holes; alpha 0 outside outer or inside any hole).
- Hit-test: in outer AND not in any hole.
- `/dev/trace`: "穴を追加" mode toggle that converts the next click sequence into a hole ring under the active polygon.

Items 1 and 2 share infrastructure (multi-ring schema, mask rasterizer rewrite). They could be **merged into one change** for ~30 % work savings.

### Item 3 — Higher-fidelity texture for grain-detail parts *(future change: `add-per-option-finish-renders`)*

The workbook swatches are small (~64×64) color samples. When the seed pipeline puts that swatch directly into the `textureUrl` of a texture-mode option, the runtime stretches it across the part region — and for door panels (⑩ ドアパネル EXIMA80St with 30 wood-grain options, ⑬ パネル ドレタスB-XF with 12 options) the result looks nothing like the actual finish.

The base-variant pipeline (`add-base-variant-finishes`) is the partial fix when the customer renders a whole-scene variant. But for parts with N options where N > 3, asking the customer to render N variants per part is unrealistic.

Spec impact:
- `finish-spec-catalog`: an option MAY declare a `customTextureUrl` pointing at a designer-authored, scene-resolution finish render specific to that one option (independent of any base variant).
- Pipeline: a new `seed:custom-textures` step that scans `resources/finishes/<partId>/<optionId>.jpg` and, if present, crops it by the part's mask and writes to the option's `textureUrl` (overriding both workbook swatches and base-variant cuts).
- Authoring guide (`AUTHORING.md`): document the per-option render workflow.

### Item 4 — AI-assisted asset generation *(exploration spike: `spike-ai-asset-generation`)*

For the long tail of options (e.g. ⑩'s 30 door-panel finishes, ⑬'s 12 interior-door finishes), per-option scene-resolution renders are expensive to author by hand. Worth investigating:

- Inpainting models (Stable Diffusion + ControlNet) seeded with the part mask + a workbook swatch as the style reference, generating a scene-resolution finish render for each option automatically.
- Style-transfer / texture-warp pipelines that take a small swatch + the natural base's masked region and produce a perspective-aware variant.
- Off-the-shelf alternatives (e.g. Midjourney + manual masking, Adobe Firefly's Generative Fill).

Outcome: a spike (1 week effort, no production code) that picks one technique and produces 5 sample door-panel finishes for visual review. If quality is acceptable, build the pipeline (Item 3's `seed:custom-textures` step gets a sub-step that pulls AI-generated assets). If not, fall back to designer-authored renders only.

This item produces **no spec change directly** — it's a research note. The output will inform whether Item 3's pipeline integrates an AI-generated input source.

### Item 5 — Background image color correction *(asset task, no spec change)*

The supplied `ベースパース_natural.jpg` (and likely sharp / flat) renders with a perceptibly off color cast (warmer / cooler than intended) which makes the composited finishes look wrong against the natural backdrop.

Action: ask the customer to re-render with the correct color profile / LUT, or apply a server-side color correction (sharp's `linear` / `modulate` / ICC profile handling) at the seed step.

Decision needed: customer-side re-render vs. our-side correction. Prefer customer-side (single source of truth, no double-correction risk).

This item is **not a spec change** — it's an asset action, captured here for handoff. If we choose our-side correction, that becomes a tiny pipeline change (one-line sharp call in seed:variants) — no spec deltas.

## Capabilities

### New Capabilities
<!-- None — items 1-3 modify existing capabilities; items 4-5 are not spec changes. -->

### Modified Capabilities
- `numbered-part-overlay`: per-part polygon model gains multi-region (Item 1) and holes (Item 2). Implementation in follow-up changes.
- `finish-spec-catalog`: option entry gains optional `customTextureUrl` (Item 3). Implementation in a follow-up change.

## Impact

This change is documentation only. Each item below is sized as a separate downstream change:

| Item | Follow-up change | Scope | Sizing |
| --- | --- | --- | --- |
| 1 | `add-multipolygon-parts` | schema + mask rasterizer + hit-test + /dev/trace UI | medium (~16 h) |
| 2 | `add-polygon-holes` | as Item 1, plus even-odd fill + hole-mode UI | medium (~21 h, or ~30 h combined with Item 1 — saves ~7 h) |
| 3 | `add-per-option-finish-renders` | new `customTextureUrl` field + `seed:custom-textures` step + docs | small-medium (~6 h dev, designer effort N/A) |
| 4 | `spike-ai-asset-generation` | research spike, no production change | medium (~16 h spike; +16-24 h impl if pursued) |
| 5 | (no change — asset action) | re-render or one-line color correction in seed:variants | trivial (~4 h max) |

Estimated total of remaining work directly tied to this proposal: **47 h dev** (60 h with the AI spike) — see the project-wide hour breakdown delivered alongside this memo.
