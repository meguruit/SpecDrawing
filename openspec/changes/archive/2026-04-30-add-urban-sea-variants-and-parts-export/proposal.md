## Why

The customer-facing app currently shows a single fixed base perspective and only lets the user pick per-part finishes. Designers have already supplied three "シャープ" mood variants of the perspective (`base_natural.jpg`, `base_flat.jpg`, `base_sharp.jpg`), but those variants are consumed only by the seed-time pipeline. Customers cannot try the same room rendered in different moods, and there is no way to walk away from a session with a tidy spec sheet of what they picked.

The "アーバンシー" sheet is the right place to land both improvements: it is the showcase sheet, its parts are dominated by surface textures (flooring, wall paneling, sash, tile) rather than freely-recolored cloth, and the customer-supplied 部材リスト.xlsx already keys off this sheet for product codes and thumbnails.

## What Changes

- Add a **runtime base-variant switcher** (Natural / Flat / Sharp) on the アーバンシー sheet. Switching:
  - swaps the canvas backdrop to the matching `base_<variant>.jpg`,
  - re-points every texture-mode part's `textureUrl` to the variant-specific crop,
  - leaves color-mode parts (accent cloth) untouched.
- Set the **default render-mode policy on アーバンシー**: every part EXCEPT accent cloth (キッチン accent cloth and 収納 accent cloth) renders in `texture` mode, sourced per active variant. Accent cloth parts stay in `color` mode so the customer's chosen color still applies.
- Extend the seed pipeline so a designer-prepared **`部材リスト.xlsx`** drives part-name + product-code + icon-image mapping for every option, AND emits per-variant texture crops for texture-mode parts on アーバンシー (`<optionId>__natural.png`, `__flat.png`, `__sharp.png`) plus a per-option icon thumbnail for the Excel export.
- Add a **"選択部材エクスポート"** action that downloads two files for the currently displayed perspective:
  1. the canvas as a PNG (extends the existing PNG export with the active variant suffix in the filename), and
  2. an Excel (.xlsx) listing every selected part as a row — part number, label, selected option label, product code, and an embedded icon image.
- Schema additions:
  - `scenes.json` / `scene.json` gain a `variants: { key, label, baseImageUrl }[]` array and a `variantsEnabled` flag on the sheet config.
  - `finish-options.json` entries for texture-mode parts on variant-enabled sheets gain `textureUrlByVariant: Record<VariantKey, string>` and an `iconUrl` field.
- **BREAKING (designer-side)**: `parts.json` is updated so that every non-accent-cloth part on the アーバンシー scene declares `renderMode: "texture"`; any color-mode options previously supplied for those parts on アーバンシー are removed from the workbook. Other sheets (e.g. レコリード) are not touched by this change.

## Capabilities

### New Capabilities
<!-- None. All work attaches to existing capabilities. -->

### Modified Capabilities

- `base-perspective-registry`: variants are no longer designer-side-only. The registry exposes them to the runtime so the canvas can fetch `base_<variant>.jpg` after first paint.
- `presentation-canvas`: canvas state gains an `activeVariantKey`, and the UI gains a variant-switcher control that is visible only on sheets where `variantsEnabled === true`.
- `finish-spec-catalog`: a texture-mode option on a variant-enabled sheet MUST carry a `textureUrlByVariant` map covering every variant the sheet declares; `iconUrl` becomes a required field on every option for the Excel export.
- `project-export`: the export action becomes a two-file download (PNG + .xlsx). The Excel export lists currently-selected parts with embedded icon images and product codes; the PNG export's filename includes the active variant key.
- `numbered-part-overlay`: the アーバンシー scene's `parts.json` is rewritten so non-accent parts are `renderMode: "texture"`. The capability requirement does not gain new rules, but the manifest content for that scene changes materially, so the spec carries a delta noting the policy.

## Impact

- **Code**: `lib/parts/`, `lib/finish/`, `components/parts/`, the canvas store, the export action, and the seed scripts (`seed:parts`, `seed:variants`, plus a new `seed:icons` step or extension).
- **Assets**:
  - `public/assets/base/main/base_{natural,flat,sharp}.jpg` are now runtime assets (not just seed inputs).
  - `public/assets/finishes/<partId>/<optionId>__<variant>.png` for every texture-mode option on a variant-enabled sheet.
  - `public/catalog/icons/<optionId>.png` for the Excel export.
- **Schemas**: `partsManifestSchema`, `finishOptionsSchema`, `scenesSchema` (Zod) all gain new fields. Old files without those fields fail validation, so the seed pipeline must run before the runtime can boot on the new schema.
- **Dependencies**: an Excel writer library (e.g. `exceljs`) is added.
- **Workbook**: the customer-prepared `resources/catalog/部材リスト.xlsx` must include columns for product code AND a per-option icon-image filename; the seed pipeline copies the icon into `public/catalog/icons/`.
- **Out of scope**: variant switching on other sheets (レコリード etc.), customer-editable variant labels, batch export of multiple variants in one click.
