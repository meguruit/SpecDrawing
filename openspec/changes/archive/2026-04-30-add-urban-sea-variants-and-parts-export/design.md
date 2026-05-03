## Context

The app today has three pieces of state controlling what the canvas shows: the active scene, the active option-sheet (`アーバンシー` / `レコリード`), and a per-part finish-selection map. The scene is fixed (`main`) and its backdrop is `base.jpg` (the natural variant). Customers can only change the appearance of individual parts.

Designers already deliver three "mood" variants of the perspective — `base_natural.jpg`, `base_flat.jpg`, `base_sharp.jpg` — and the seed pipeline can crop those variants per-option via the `finish-base-overrides.json` config (see `finish-spec-catalog`'s "Per-option base-variant override config" requirement). But that pipeline is **per-option**, requires a designer to enumerate every `(partId, label)` pair, and is consumed only at seed time. There is no runtime equivalent and no way for a customer to flip the whole room from "natural" to "sharp" in one click.

Separately, the customer-facing PNG export does not include any structured spec sheet of what was selected. Customers walk away with an image but no document linking each part to its product code or icon, which the showroom team has to assemble by hand.

This change wires the variant images into the runtime, scopes the variant switcher to the アーバンシー sheet (because that is the sheet the customer-prepared 部材リスト.xlsx covers), and adds a structured Excel export alongside the existing PNG.

## Goals / Non-Goals

**Goals:**
- A first-class runtime variant switcher (Natural / Flat / Sharp) on the アーバンシー sheet that swaps the canvas backdrop AND every texture-mode part's source crop atomically.
- Treat texture as the default rendering mode for the アーバンシー sheet; only kitchen and storage accent cloth remain color-mode.
- Ship a two-file export (PNG of the canvas + .xlsx listing selected parts with embedded icon images) that customers can take home as a personalized spec sheet.
- Keep all variant data static — pre-cropped at seed time — so the runtime never has to do per-pixel work in the browser.
- Keep the door open for future sheets to opt in by setting `variantsEnabled: true` and supplying their own variant crops.

**Non-Goals:**
- Variant switching on the レコリード or any sheet beyond アーバンシー in this change.
- Letting customers upload their own variant images, edit variant labels, or define new variant keys.
- A multi-variant export (e.g. "give me a PDF with all three variants side-by-side"). One variant per export.
- Replacing or duplicating the existing `finish-base-overrides.json` per-option override mechanism — the new flow uses it as a building block, not a replacement.
- Touching color-mode rendering for accent cloth — the existing color overlay path is unchanged.

## Decisions

### Decision 1: The variant switcher swaps only the base perspective

**Choice:** Switching the variant swaps the canvas backdrop to `base_<variant>.jpg` and nothing else. Selected options keep their assigned `option.textureUrl` (set at seed time by `finish-base-overrides.json`, which already maps each option to a specific variant). The runtime does NOT consult `option.textureUrlByVariant` when rendering a selected texture; that field stays as designer-side metadata.

**Alternatives considered:**
- *Per-variant lookup at render time* (initial design): on variant change, swap each selected option's texture to `option.textureUrlByVariant[activeVariantKey]`. **Rejected after a live test on アーバンシー** — picking "ﾁｬｲﾅ大理石(黒)" while on Natural variant would load `_v_natural.png` (the natural base's kitchen-top region, which is *white*), so the on-canvas overlay no longer matched the option's name. The customer's mental model is "variant = mood; option = material" — they should be independent.
- *Runtime cropping*: load `base_<variant>.jpg` once and mask it client-side per part. Rejected because the seed pipeline already produces these crops.

**Rationale:** Decoupling "room mood" (variant) from "option appearance" (option texture) preserves the labelling integrity of the workbook: an option named "黒大理石" always paints the sharp-base black-marble crop, regardless of which variant the customer is previewing. The variant switcher only changes what the *unselected* parts of the room look like.

### Decision 2: `variantsEnabled` flag lives on the sheet config, not the scene

**Choice:** `finish-spec-catalog` declares which sheets enable variants. The scene registry exposes the variant images, but it is the sheet that decides whether the runtime UI shows the variant switcher.

**Alternatives considered:**
- *Variant switcher always visible if scene has variants*: rejected because non-customer sheets (e.g. レコリード) may not have texture options for every non-accent part, so flipping variants would break their finish layers.
- *Variant flag on the scene only*: rejected for the same reason — variant-enabled is fundamentally a property of the option-set, not the perspective.

**Rationale:** Variants and option-sheets are coupled by texture availability. Tying the flag to the sheet keeps the coupling explicit.

### Decision 3: Accent cloth identification — by part id list, not by category

**Choice:** The accent-cloth exemption is encoded as an explicit list of part ids in `parts.json` — exactly `"07"` (キッチンアクセントクロス) and `"16"` (収納アクセントクロス) stay `renderMode: "color"`; every other part on scene `main` is `renderMode: "texture"`. We do NOT introduce a "cloth-or-not" category field on parts.

**Alternatives considered:**
- *Add a per-part `acceptsColor: boolean`*: rejected as redundant with `renderMode: "color"`.
- *Derive from category strings* (`収納アクセント`, etc.): rejected because category strings are display labels and could change.

**Rationale:** The set is small (two parts), the list is in one file, and the existing `renderMode` field already encodes the runtime behavior unambiguously.

### Decision 4: Excel export uses `exceljs` and embeds icons inline

**Choice:** Add `exceljs` (BSD-licensed, actively maintained, no native deps) as a runtime dependency. The export action assembles a workbook with one sheet, one row per selected part, and embeds each option's icon PNG via `worksheet.addImage` so the file is self-contained.

**Alternatives considered:**
- *`xlsx` (sheetjs)*: rejected because community edition has limited image support.
- *CSV*: rejected — customers expect a styled sheet with images, not a text file.
- *Server-side generation*: rejected — keeps the export action symmetric with the existing client-only PNG export and avoids adding a new API route.

**Rationale:** `exceljs` is the smallest dep that supports embedded images cleanly in pure-browser builds.

### Decision 5: Filename pattern

**Choice:** PNG filename becomes `specdrawing-<sceneId>-<variantKey>-<timestamp>.png`. Excel filename is `specdrawing-<sceneId>-<variantKey>-<timestamp>.xlsx`. Same timestamp across both files when the user clicks export, so the pair is identifiable.

**Rationale:** Extends the existing `project-export` filename rule rather than diverging.

### Decision 6: Schema migration is a hard cut, not gradual

**Choice:** The new `variants` array on `scene.json`, the new `textureUrlByVariant` and `iconUrl` fields on options, and the rewritten アーバンシー `parts.json` all land together. The Zod schemas reject old files. Both the seed pipeline and the runtime require the new shape on next boot.

**Alternatives considered:**
- *Optional fields with runtime fallback*: rejected — the whole point of the variant switcher is that variants exist; a missing-variant fallback would silently drop the customer back to a single-variant world without a visible error.
- *Feature flag*: rejected — there is no in-flight customer session to protect, and the seed step can be re-run.

**Rationale:** This is a designer-driven authoring change; the seed step runs before the runtime ever serves a request. A loud schema error during the migration is better than a silently degraded experience.

## Risks / Trade-offs

- **[Risk] Disk-size growth from per-variant crops** — three PNGs per texture-mode option × ~15 non-accent parts × N options-per-part. Could push `public/assets/finishes/` into the tens of MB.
  → *Mitigation*: PNGs are masked (transparent outside the part region), so most pixels are alpha-zero and compress well. Spot-check sizes during the seed step; if growth is ugly we can switch to WebP later.

- **[Risk] Variant switch causes visible flicker as three textures reload** — Konva re-mounts every `useImage` when its URL changes.
  → *Mitigation*: Pre-fetch all three variants of every selected part on first paint (or on first variant switch) so subsequent switches hit the browser cache.

- **[Risk] `exceljs` browser bundle size** — adds ~200KB gzipped to the client bundle.
  → *Mitigation*: dynamic-import the export module so the cost lands only when the user clicks export.

- **[Risk] レコリード sheet breaks** — if a part previously color-mode on アーバンシー is now texture-mode globally, レコリード options for that part are now schema-invalid (color options pointing at a texture-mode part).
  → *Mitigation*: this is the BREAKING flagged in the proposal. The seed pipeline emits a warning per affected option, and we either rewrite レコリード options to texture-mode at seed time (preferred) or drop them with a noted gap. The Zod refinement that rejects the mismatch already exists in `partSchema` — the seed step must clean the workbook before runtime sees it.

- **[Trade-off] Three variants × every option = three times the seed work** — `seed:variants` already exists per-option; we need to extend it to emit `__natural`, `__flat`, `__sharp` for every option of a variant-enabled sheet.
  → Acceptable: the script is idempotent and the seed step is offline. If it gets too slow, parallelize the per-option masking.

- **[Trade-off] Customer cannot mix variants per-part** — if they want flooring from `sharp` but walls from `flat`, this change does not support it. The variant switch is room-wide.
  → Acceptable per the user's request. The existing `finish-base-overrides.json` mechanism still allows a designer to mix variants per option at seed time, just not at runtime.

## Migration Plan

1. Land the schema changes and new types behind a feature branch; run `seed:parts`, `seed:variants`, and the new `seed:icons` against an updated 部材リスト.xlsx in CI to confirm the pipeline produces the expected outputs.
2. Update アーバンシー `parts.json`: flip non-accent parts to `renderMode: "texture"`. Verify Zod validation on next boot.
3. Add the runtime variant-switcher control behind the existing sheet switcher; verify it is hidden on レコリード.
4. Add the dynamic-imported export module; verify the .xlsx opens correctly in Excel and Numbers.
5. **Rollback**: revert the parts.json and `scene.json` changes, re-run the prior seed step. The runtime variant-switcher control is purely additive UI and disappears when `variantsEnabled` is false on every sheet.

## Resolved Questions

- **Accent-cloth part ids**: confirmed as `"07"` (キッチンアクセントクロス, `category: "キッチン"`) and `"16"` (収納アクセントクロス, `category: "収納アクセント"`). Frozen in [specs/numbered-part-overlay/spec.md](specs/numbered-part-overlay/spec.md).
- **Excel row coverage**: every part in `parts.json` gets a row. Parts without a user selection fall back to the sheet's **default option** (the first entry the seed pipeline emits for `(partId, activeOptionSheet)`, i.e. workbook order in `部材リスト.xlsx`). Parts whose `(partId, sheet)` has zero options get a row with blank option columns and `選択状態 = "対象外"`. This matches the "選択した（表示された）" reading: defaults are what the canvas actually displays before the customer touches anything.

## Open Questions

- Icon resolution for the Excel export: 96 px square is probably fine for thumbnails inside a spreadsheet cell, but the customer may want larger. Default to 96 px and revisit if feedback comes back.
- Whether the `選択状態` column should appear in the customer-delivered file or only in an internal QA build. Defaulting to "always shown" since it makes the spec sheet self-documenting.
